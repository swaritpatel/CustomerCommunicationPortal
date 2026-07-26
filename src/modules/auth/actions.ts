"use server";

import { createHash, randomBytes } from "node:crypto";

import { redirect } from "next/navigation";

import { serverEnv } from "@/lib/env";
import { db, type DbTransactionClient } from "@/lib/db";
import type { AuthActionState } from "@/modules/auth/form-state";
import { forgotPasswordSchema, loginSchema, resetPasswordSchema, signupSchema } from "@/modules/auth/schemas";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { clearSession, issueSession } from "@/modules/auth/session";
import { sendSupportEmail } from "@/modules/email/smtp";
import { chatLog } from "@/modules/chat/log";
import { getErrorDetails } from "@/modules/observability/log";
import { acceptInviteForUser } from "@/modules/team/invites";
import { toWorkspaceSlug } from "@/modules/workspaces/slug";

const PASSWORD_RESET_TOKEN_BYTES = 32;
const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function errorState(message: string, fieldErrors?: Record<string, string[]>) {
  return {
    status: "error",
    message,
    fieldErrors,
  } satisfies AuthActionState;
}

function successState(message: string) {
  return {
    status: "success",
    message,
  } satisfies AuthActionState;
}

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function buildPasswordResetUrl(token: string) {
  const url = new URL("/reset-password", serverEnv.APP_URL);
  url.searchParams.set("token", token);
  return url.toString();
}

function resetEmailText(input: { fullName: string; resetUrl: string }) {
  return [
    `Hi ${input.fullName},`,
    "",
    "We received a request to reset the password for your Customer Communication Portal account.",
    "",
    "Use the link below to create a new password. This link expires in 30 minutes:",
    input.resetUrl,
    "",
    "If you did not request this, you can safely ignore this email. Your current password will continue to work.",
    "",
    "Best,",
    "CCP Support",
  ].join("\n");
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
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

export async function signupAction(
  _previousState: AuthActionState,
  formData: FormData,
) {
  const inviteToken = getString(formData, "inviteToken");
  const parsedInput = signupSchema.safeParse({
    workspaceName: getString(formData, "workspaceName"),
    fullName: getString(formData, "fullName"),
    email: getString(formData, "email"),
    password: getString(formData, "password"),
  });

  if (!parsedInput.success) {
    return errorState("Please fix the highlighted fields.", parsedInput.error.flatten().fieldErrors);
  }

  const workspaceSlug = await generateUniqueWorkspaceSlug(parsedInput.data.workspaceName);
  const passwordHash = await hashPassword(parsedInput.data.password);

  try {
    if (inviteToken) {
      const result = await db.$transaction(async (tx: DbTransactionClient) => {
        const user = await tx.user.create({
          data: {
            fullName: parsedInput.data.fullName,
            email: parsedInput.data.email,
            passwordHash,
          },
        });

        const accepted = await acceptInviteForUser(tx, {
          token: inviteToken,
          userId: user.id,
          email: user.email,
        });

        if (!accepted.ok) {
          throw new Error(`Invite could not be accepted: ${accepted.reason}`);
        }

        await tx.auditLog.create({
          data: {
            workspaceId: accepted.membership.workspaceId,
            actorUserId: user.id,
            action: "USER_SIGNED_UP",
            entityType: "user",
            entityId: user.id,
            metadata: { email: user.email, source: "invite" },
          },
        });

        return { user, membership: accepted.membership };
      });

      await issueSession({
        sub: result.user.id,
        email: result.user.email,
        workspaceId: result.membership.workspace.id,
        workspaceSlug: result.membership.workspace.slug,
        role: result.membership.role,
      });

      redirect("/dashboard");
    }

    const result = await db.$transaction(async (tx: DbTransactionClient) => {
      const user = await tx.user.create({
        data: {
          fullName: parsedInput.data.fullName,
          email: parsedInput.data.email,
          passwordHash,
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: parsedInput.data.workspaceName,
          slug: workspaceSlug,
          ownerId: user.id,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: "ADMIN",
          status: "ACTIVE",
          joinedAt: new Date(),
        },
      });

      await tx.auditLog.createMany({
        data: [
          {
            actorUserId: user.id,
            action: "USER_SIGNED_UP",
            entityType: "user",
            entityId: user.id,
            metadata: { email: user.email },
          },
          {
            workspaceId: workspace.id,
            actorUserId: user.id,
            action: "WORKSPACE_CREATED",
            entityType: "workspace",
            entityId: workspace.id,
            metadata: { slug: workspace.slug },
          },
        ],
      });

      return {
        user,
        workspace,
      };
    });

    await issueSession({
      sub: result.user.id,
      email: result.user.email,
      workspaceId: result.workspace.id,
      workspaceSlug: result.workspace.slug,
      role: "ADMIN",
    });
  } catch (error) {
    if (
      isUniqueConstraintError(error)
    ) {
      return errorState(
        "We could not create this account. If you already have access, log in instead.",
      );
    }

    return errorState("We could not create the workspace right now. Please retry.");
  }

  redirect("/dashboard");
}

export async function loginAction(
  _previousState: AuthActionState,
  formData: FormData,
) {
  const inviteToken = getString(formData, "inviteToken");
  const parsedInput = loginSchema.safeParse({
    email: getString(formData, "email"),
    password: getString(formData, "password"),
  });

  if (!parsedInput.success) {
    return errorState("Please fix the highlighted fields.", parsedInput.error.flatten().fieldErrors);
  }

  const user = await db.user.findUnique({
    where: { email: parsedInput.data.email },
    include: {
      memberships: {
        where: {
          status: "ACTIVE",
        },
        include: {
          workspace: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!user) {
    return errorState("Invalid email or password.");
  }

  const passwordMatches = await verifyPassword(parsedInput.data.password, user.passwordHash);

  if (!passwordMatches) {
    return errorState("Invalid email or password.");
  }

  let primaryMembership = user.memberships[0];

  if (inviteToken) {
    const accepted = await db.$transaction(async (tx: DbTransactionClient) =>
      acceptInviteForUser(tx, {
        token: inviteToken,
        userId: user.id,
        email: user.email,
      }),
    );

    if (!accepted.ok) {
      return errorState(
        accepted.reason === "email_mismatch"
          ? "This invite was sent to a different email address."
          : "This invite is invalid or has expired.",
      );
    }

    primaryMembership = accepted.membership;
  }

  if (!primaryMembership) {
    return errorState("This account does not have an active workspace membership.");
  }

  await issueSession({
    sub: user.id,
    email: user.email,
    workspaceId: primaryMembership.workspace.id,
    workspaceSlug: primaryMembership.workspace.slug,
    role: primaryMembership.role,
  });

  await db.auditLog.create({
    data: {
      workspaceId: primaryMembership.workspace.id,
      actorUserId: user.id,
      action: "USER_LOGGED_IN",
      entityType: "user",
      entityId: user.id,
      metadata: { workspaceId: primaryMembership.workspace.id },
    },
  });

  redirect("/dashboard");
}

export async function forgotPasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsedInput = forgotPasswordSchema.safeParse({
    email: getString(formData, "email"),
  });

  if (!parsedInput.success) {
    return errorState("Please enter a valid email address.", parsedInput.error.flatten().fieldErrors);
  }

  const responseMessage = "If an account exists for that email, a password reset link has been sent.";
  const user = await db.user.findUnique({
    where: { email: parsedInput.data.email },
    select: {
      id: true,
      email: true,
      fullName: true,
      memberships: {
        where: { status: "ACTIVE" },
        select: { workspaceId: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  if (!user) {
    chatLog("info", "password_reset_requested_unknown_email", {
      email: parsedInput.data.email,
    });
    return successState(responseMessage);
  }

  const rawToken = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashResetToken(rawToken);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);
  const resetUrl = buildPasswordResetUrl(rawToken);

  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  await db.auditLog.create({
    data: {
      workspaceId: user.memberships[0]?.workspaceId,
      actorUserId: user.id,
      action: "PASSWORD_RESET_REQUESTED",
      entityType: "user",
      entityId: user.id,
      metadata: { email: user.email },
    },
  });

  try {
    await sendSupportEmail({
      to: user.email,
      subject: "Reset your Customer Communication Portal password",
      text: resetEmailText({
        fullName: user.fullName,
        resetUrl,
      }),
    });

    chatLog("info", "password_reset_email_sent", {
      userId: user.id,
      email: user.email,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    chatLog("error", "password_reset_email_failed", {
      userId: user.id,
      email: user.email,
      error: getErrorDetails(error),
    });
  }

  return successState(responseMessage);
}

export async function resetPasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsedInput = resetPasswordSchema.safeParse({
    token: getString(formData, "token"),
    password: getString(formData, "password"),
    confirmPassword: getString(formData, "confirmPassword"),
  });

  if (!parsedInput.success) {
    return errorState("Please fix the highlighted fields.", parsedInput.error.flatten().fieldErrors);
  }

  const tokenHash = hashResetToken(parsedInput.data.token);
  const resetToken = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          memberships: {
            where: { status: "ACTIVE" },
            include: { workspace: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date()) {
    return errorState("This reset link is invalid or has expired. Please request a new one.");
  }

  const passwordHash = await hashPassword(parsedInput.data.password);
  const primaryMembership = resetToken.user.memberships[0];

  await db.$transaction(async (tx: DbTransactionClient) => {
    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    });

    await tx.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });

    await tx.passwordResetToken.updateMany({
      where: {
        userId: resetToken.userId,
        usedAt: null,
        id: { not: resetToken.id },
      },
      data: { usedAt: new Date() },
    });

    await tx.session.updateMany({
      where: {
        userId: resetToken.userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        workspaceId: primaryMembership?.workspaceId,
        actorUserId: resetToken.userId,
        action: "PASSWORD_RESET_COMPLETED",
        entityType: "user",
        entityId: resetToken.userId,
        metadata: { email: resetToken.user.email },
      },
    });
  });

  if (!primaryMembership) {
    return successState("Your password has been reset. Please log in.");
  }

  await issueSession({
    sub: resetToken.user.id,
    email: resetToken.user.email,
    workspaceId: primaryMembership.workspace.id,
    workspaceSlug: primaryMembership.workspace.slug,
    role: primaryMembership.role,
  });

  redirect("/dashboard");
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}
