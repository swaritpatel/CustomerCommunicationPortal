import { db, type DbTransactionClient } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import type { WorkspaceRole } from "@prisma/client";
import { sendWorkspaceSupportEmail } from "@/modules/email/send";
import { getErrorDetails, appLog } from "@/modules/observability/log";

export function buildInviteUrl(token: string) {
  const url = new URL(`/invites/${token}`, serverEnv.APP_URL);
  return url.toString();
}

export async function sendTeamInviteEmail(input: {
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: WorkspaceRole;
  token: string;
  invitedByName: string;
}) {
  const inviteUrl = buildInviteUrl(input.token);
  const subject = `You're invited to join ${input.workspaceName} on CCP`;
  const text = [
    `Hello,`,
    ``,
    `${input.invitedByName} invited you to join ${input.workspaceName} as ${input.role.toLowerCase()}.`,
    ``,
    `Accept your invite and create your account here:`,
    inviteUrl,
    ``,
    `This invite is valid for 7 days. If you were not expecting this invitation, you can ignore this email.`,
    ``,
    `Best,`,
    `CCP Team`,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">
      <p>Hello,</p>
      <p><strong>${escapeHtml(input.invitedByName)}</strong> invited you to join <strong>${escapeHtml(input.workspaceName)}</strong> as ${escapeHtml(input.role.toLowerCase())}.</p>
      <p>
        <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">
          Accept invite
        </a>
      </p>
      <p>Or open this link: <a href="${escapeHtml(inviteUrl)}">${escapeHtml(inviteUrl)}</a></p>
      <p>This invite is valid for 7 days. If you were not expecting this invitation, you can ignore this email.</p>
      <p>Best,<br/>CCP Team</p>
    </div>
  `;

  try {
    await sendWorkspaceSupportEmail({
      workspaceId: input.workspaceId,
      to: input.email,
      subject,
      text,
      html,
    });
    appLog("info", "team.invite_email_sent", {
      workspaceId: input.workspaceId,
      email: input.email,
      role: input.role,
    });
  } catch (error) {
    appLog("error", "team.invite_email_failed", {
      workspaceId: input.workspaceId,
      email: input.email,
      role: input.role,
      error: getErrorDetails(error),
    });
  }
}

export async function findUsableInvite(token: string) {
  return db.invite.findUnique({
    where: { token },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });
}

export async function acceptInviteForUser(
  tx: DbTransactionClient,
  input: {
    token: string;
    userId: string;
    email: string;
  },
) {
  const invite = await tx.invite.findUnique({
    where: { token: input.token },
    include: { workspace: true },
  });

  if (!invite || invite.status !== "PENDING" || invite.expiresAt <= new Date()) {
    return { ok: false as const, reason: "invalid" as const };
  }

  if (invite.email.toLowerCase() !== input.email.toLowerCase()) {
    return { ok: false as const, reason: "email_mismatch" as const };
  }

  const membership = await tx.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: invite.workspaceId,
        userId: input.userId,
      },
    },
    create: {
      workspaceId: invite.workspaceId,
      userId: input.userId,
      role: invite.role,
      status: "ACTIVE",
      invitedAt: invite.createdAt,
      joinedAt: new Date(),
    },
    update: {
      role: invite.role,
      status: "ACTIVE",
      removedAt: null,
      joinedAt: new Date(),
    },
    include: { workspace: true },
  });

  await tx.invite.update({
    where: { id: invite.id },
    data: {
      status: "ACCEPTED",
      acceptedAt: new Date(),
      acceptedById: input.userId,
    },
  });

  await tx.auditLog.create({
    data: {
      workspaceId: invite.workspaceId,
      actorUserId: input.userId,
      action: "INVITE_ACCEPTED",
      entityType: "invite",
      entityId: invite.id,
      metadata: {
        email: invite.email,
        role: invite.role,
      },
    },
  });

  return { ok: true as const, membership };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
