import { jwtVerify } from "jose";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { exchangeGoogleCode, getGoogleProfile, isGmailConfigured } from "@/modules/email/gmail";
import { withApiLogging } from "@/modules/observability/api";

const stateSecret = new TextEncoder().encode(serverEnv.JWT_ACCESS_SECRET);

type GoogleOAuthState = {
  workspaceId?: unknown;
  workspaceSlug?: unknown;
  userId?: unknown;
};

function redirectToInbox(request: Request, params?: Record<string, string>) {
  const url = new URL("/inbox", serverEnv.APP_URL || new URL(request.url).origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

async function GETHandler(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return redirectToInbox(request, { gmail: "denied" });
  }

  if (!code || !state) {
    return redirectToInbox(request, { gmail: "missing" });
  }

  if (!isGmailConfigured()) {
    return redirectToInbox(request, { gmail: "not_configured" });
  }

  try {
    const verified = await jwtVerify(state, stateSecret);
    const payload = verified.payload as GoogleOAuthState;

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
    return redirectToInbox(request, { gmail: "failed" });
  }
}

export const GET = withApiLogging(GETHandler, "GET src/app/api/auth/google/callback");
