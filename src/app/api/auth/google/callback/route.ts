import { jwtVerify } from "jose";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { hashPassword } from "@/modules/auth/password";
import { issueSession } from "@/modules/auth/session";
import { acceptInviteForUser } from "@/modules/team/invites";
import {
  exchangeGoogleCode,
  getGoogleAccountProfile,
  getGoogleProfile,
  isGmailConfigured,
} from "@/modules/email/gmail";
import { withApiLogging } from "@/modules/observability/api";
import { toWorkspaceSlug } from "@/modules/workspaces/slug";

const stateSecret = new TextEncoder().encode(serverEnv.JWT_ACCESS_SECRET);

type GoogleOAuthState = {
  purpose?: unknown;
  mode?: unknown;
  workspaceId?: unknown;
  workspaceSlug?: unknown;
  userId?: unknown;
};

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function redirectToLogin(request: Request, params?: Record<string, string>) {
  const url = new URL("/login", serverEnv.APP_URL || new URL(request.url).origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

async function generateUniqueWorkspaceSlug(name: string) {
  const baseSlug = toWorkspaceSlug(name) || `workspace-${crypto.randomUUID().slice(0, 8)}`;

  for (let index = 0; index < 10; index += 1) {
    const candidate = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
    const existingWorkspace = await db.workspace.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });

    if (!existingWorkspace) {
      return candidate;
    }
  }

  return `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`;
}

function workspaceNameFromProfile(input: { name?: string; email: string }) {
  const domain = input.email.split("@")[1]?.split(".")[0];
  const base = input.name?.trim() || domain || "New";
  return `${base}'s Workspace`;
}

function redirectToInbox(request: Request, params?: Record<string, string>) {
  const url = new URL("/inbox", serverEnv.APP_URL || new URL(request.url).origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

async function handleAccountAuth(request: Request, code: string) {
  const tokens = await exchangeGoogleCode(code);
  const profile = await getGoogleAccountProfile(tokens.access_token!);
  const email = profile.email?.toLowerCase();

  if (!email || profile.email_verified === false) {
    return redirectToLogin(request, { google: "unverified" });
  }

  const fullName = profile.name?.trim() || profile.given_name?.trim() || email.split("@")[0] || "Google User";
  const inviteToken = readCookie(request, "relaydesk_invite");

  if (inviteToken) {
    const result = await db.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email },
      });
      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            fullName,
            email,
            passwordHash: await hashPassword(crypto.randomUUID()),
            emailVerifiedAt: new Date(),
          },
        }));

      const accepted = await acceptInviteForUser(tx, {
        token: inviteToken,
        userId: user.id,
        email: user.email,
      });

      if (!accepted.ok) {
        throw new Error(`Invite could not be accepted: ${accepted.reason}`);
      }

      if (!existingUser) {
        await tx.auditLog.create({
          data: {
            workspaceId: accepted.membership.workspaceId,
            actorUserId: user.id,
            action: "USER_SIGNED_UP",
            entityType: "user",
            entityId: user.id,
            metadata: { email: user.email, provider: "google", source: "invite" },
          },
        });
      }

      return {
        user,
        membership: accepted.membership,
        created: !existingUser,
      };
    });

    await issueSession({
      sub: result.user.id,
      email: result.user.email,
      workspaceId: result.membership.workspace.id,
      workspaceSlug: result.membership.workspace.slug,
      role: result.membership.role,
    });

    const dashboardUrl = new URL("/dashboard", serverEnv.APP_URL || new URL(request.url).origin);
    dashboardUrl.searchParams.set("google", result.created ? "invite_signed_up" : "invite_accepted");
    const response = NextResponse.redirect(dashboardUrl);
    response.cookies.set("relaydesk_invite", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  const existingUser = await db.user.findUnique({
    where: { email },
    include: {
      memberships: {
        where: { status: "ACTIVE" },
        include: { workspace: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const result = existingUser
    ? {
        user: existingUser,
        membership: existingUser.memberships[0],
        created: false,
      }
    : await db.$transaction(async (tx) => {
        const passwordHash = await hashPassword(crypto.randomUUID());
        const workspaceName = workspaceNameFromProfile({ name: fullName, email });
        const workspaceSlug = await generateUniqueWorkspaceSlug(workspaceName);
        const user = await tx.user.create({
          data: {
            fullName,
            email,
            passwordHash,
            emailVerifiedAt: new Date(),
          },
        });
        const workspace = await tx.workspace.create({
          data: {
            name: workspaceName,
            slug: workspaceSlug,
            ownerId: user.id,
          },
        });
        const membership = await tx.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: user.id,
            role: "ADMIN",
            status: "ACTIVE",
            joinedAt: new Date(),
          },
          include: { workspace: true },
        });

        await tx.auditLog.createMany({
          data: [
            {
              actorUserId: user.id,
              action: "USER_SIGNED_UP",
              entityType: "user",
              entityId: user.id,
              metadata: { email: user.email, provider: "google" },
            },
            {
              workspaceId: workspace.id,
              actorUserId: user.id,
              action: "WORKSPACE_CREATED",
              entityType: "workspace",
              entityId: workspace.id,
              metadata: { slug: workspace.slug, provider: "google" },
            },
          ],
        });

        return {
          user,
          membership,
          created: true,
        };
      });

  if (!result.membership) {
    return redirectToLogin(request, { google: "no_workspace" });
  }

  await issueSession({
    sub: result.user.id,
    email: result.user.email,
    workspaceId: result.membership.workspace.id,
    workspaceSlug: result.membership.workspace.slug,
    role: result.membership.role,
  });

  await db.auditLog.create({
    data: {
      workspaceId: result.membership.workspace.id,
      actorUserId: result.user.id,
      action: result.created ? "USER_SIGNED_UP" : "USER_LOGGED_IN",
      entityType: "user",
      entityId: result.user.id,
      metadata: { provider: "google" },
    },
  });

  const dashboardUrl = new URL("/dashboard", serverEnv.APP_URL || new URL(request.url).origin);
  dashboardUrl.searchParams.set("google", result.created ? "signed_up" : "logged_in");
  return NextResponse.redirect(dashboardUrl);
}

async function GETHandler(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  let isAccountAuth = false;

  if (error) {
    if (state) {
      const verified = await jwtVerify(state, stateSecret).catch(() => null);
      isAccountAuth = Boolean(verified?.payload && (verified.payload as GoogleOAuthState).purpose === "account_auth");
    }
    return isAccountAuth
      ? redirectToLogin(request, { google: "denied" })
      : redirectToInbox(request, { gmail: "denied" });
  }

  if (!code || !state) {
    return redirectToLogin(request, { google: "missing" });
  }

  if (!isGmailConfigured()) {
    return redirectToLogin(request, { google: "not_configured" });
  }

  try {
    const verified = await jwtVerify(state, stateSecret);
    const payload = verified.payload as GoogleOAuthState;
    isAccountAuth = payload.purpose === "account_auth";

    if (isAccountAuth) {
      return await handleAccountAuth(request, code);
    }

    if (typeof payload.workspaceId !== "string" || typeof payload.workspaceSlug !== "string") {
      return redirectToInbox(request, { gmail: "bad_state" });
    }

    const tokens = await exchangeGoogleCode(code);
    const profile = await getGoogleProfile(tokens.access_token!);
    const email = profile.emailAddress.toLowerCase();

    if (serverEnv.GMAIL_SUPPORT_EMAIL && email !== serverEnv.GMAIL_SUPPORT_EMAIL.toLowerCase()) {
      return redirectToInbox(request, { gmail: "wrong_account" });
    }

    const existing = await db.gmailIntegration.findUnique({
      where: {
        workspaceId_email: {
          workspaceId: payload.workspaceId,
          email,
        },
      },
      select: { id: true, refreshToken: true },
    });

    if (!tokens.refresh_token && !existing?.refreshToken) {
      return redirectToInbox(request, { gmail: "missing_refresh_token" });
    }

    await db.gmailIntegration.upsert({
      where: {
        workspaceId_email: {
          workspaceId: payload.workspaceId,
          email,
        },
      },
      create: {
        workspaceId: payload.workspaceId,
        email,
        refreshToken: tokens.refresh_token!,
        accessToken: tokens.access_token,
        expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
        historyId: profile.historyId,
      },
      update: {
        refreshToken: tokens.refresh_token || undefined,
        accessToken: tokens.access_token,
        expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
        historyId: profile.historyId || undefined,
      },
    });

    return redirectToInbox(request, { gmail: "connected" });
  } catch {
    return isAccountAuth
      ? redirectToLogin(request, { google: "failed" })
      : redirectToInbox(request, { gmail: "failed" });
  }
}

export const GET = withApiLogging(GETHandler, "GET src/app/api/auth/google/callback");
