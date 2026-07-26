"use server";

import { redirect } from "next/navigation";

import { db, type DbTransactionClient } from "@/lib/db";
import type { AuthActionState } from "@/modules/auth/form-state";
import { loginSchema, signupSchema } from "@/modules/auth/schemas";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { clearSession, issueSession } from "@/modules/auth/session";
import { acceptInviteForUser } from "@/modules/team/invites";
import { toWorkspaceSlug } from "@/modules/workspaces/slug";

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

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}
