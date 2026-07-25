"use server";

import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { INVITE_TTL_DAYS } from "@/modules/auth/constants";
import {
  assignmentSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
} from "@/modules/auth/schemas";
import { requireActiveMembership } from "@/modules/auth/guards";
import { canBeAssigned, canChangeAssignment, canManageMembers } from "@/modules/team/policy";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function revalidateTeamSurfaces() {
  revalidatePath("/team");
  revalidatePath("/chat");
}

export async function inviteMemberAction(formData: FormData) {
  const { claims } = await requireActiveMembership();

  if (!canManageMembers(claims.role)) {
    return;
  }

  const parsed = inviteMemberSchema.safeParse({
    email: readString(formData, "email"),
    role: readString(formData, "role"),
  });

  if (!parsed.success) {
    return;
  }

  const existingInvite = await db.invite.findFirst({
    where: {
      workspaceId: claims.workspaceId,
      email: parsed.data.email,
      status: "PENDING",
    },
    select: { id: true },
  });

  if (existingInvite) {
    return;
  }

  const existingUser = await db.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });

  if (existingUser) {
    const existingMembership = await db.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: claims.workspaceId,
          userId: existingUser.id,
        },
      },
      select: { id: true, status: true },
    });

    if (existingMembership && existingMembership.status !== "REMOVED") {
      return;
    }
  }

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.invite.create({
      data: {
        workspaceId: claims.workspaceId,
        email: parsed.data.email,
        role: parsed.data.role,
        token,
        expiresAt,
      },
    });

    await tx.auditLog.create({
      data: {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        action: "MEMBER_INVITED",
        entityType: "invite",
        entityId: token,
        metadata: {
          email: parsed.data.email,
          role: parsed.data.role,
        },
      },
    });
  });

  revalidateTeamSurfaces();
}

export async function updateMemberRoleAction(formData: FormData) {
  const { claims } = await requireActiveMembership();

  if (!canManageMembers(claims.role)) {
    return;
  }

  const memberId = readString(formData, "memberId");
  const parsed = updateMemberRoleSchema.safeParse({
    role: readString(formData, "role"),
  });

  if (!memberId || !parsed.success) {
    return;
  }

  const member = await db.workspaceMember.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      workspaceId: true,
    },
  });

  if (!member || member.workspaceId !== claims.workspaceId || member.status !== "ACTIVE") {
    return;
  }

  if (member.role === parsed.data.role) {
    return;
  }

  if (member.role === "ADMIN" && parsed.data.role !== "ADMIN") {
    const adminCount = await db.workspaceMember.count({
      where: {
        workspaceId: claims.workspaceId,
        status: "ACTIVE",
        role: "ADMIN",
      },
    });

    if (adminCount <= 1) {
      return;
    }
  }

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.workspaceMember.update({
      where: { id: member.id },
      data: { role: parsed.data.role },
    });

    await tx.auditLog.create({
      data: {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        action: "MEMBER_ROLE_CHANGED",
        entityType: "workspace_member",
        entityId: member.id,
        metadata: {
          fromRole: member.role,
          toRole: parsed.data.role,
          targetUserId: member.userId,
        },
      },
    });
  });

  revalidateTeamSurfaces();
}

export async function removeMemberAction(formData: FormData) {
  const { claims } = await requireActiveMembership();

  if (!canManageMembers(claims.role)) {
    return;
  }

  const memberId = readString(formData, "memberId");
  if (!memberId) {
    return;
  }

  const member = await db.workspaceMember.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      workspaceId: true,
    },
  });

  if (!member || member.workspaceId !== claims.workspaceId || member.status !== "ACTIVE") {
    return;
  }

  if (member.role === "ADMIN") {
    const adminCount = await db.workspaceMember.count({
      where: {
        workspaceId: claims.workspaceId,
        status: "ACTIVE",
        role: "ADMIN",
      },
    });

    if (adminCount <= 1) {
      return;
    }
  }

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.workspaceMember.update({
      where: { id: member.id },
      data: {
        status: "REMOVED",
        removedAt: new Date(),
      },
    });

    await tx.conversation.updateMany({
      where: {
        workspaceId: claims.workspaceId,
        currentAssigneeId: member.userId,
      },
      data: {
        currentAssigneeId: null,
      },
    });

    await tx.auditLog.create({
      data: {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        action: "MEMBER_REMOVED",
        entityType: "workspace_member",
        entityId: member.id,
        metadata: { targetUserId: member.userId },
      },
    });
  });

  revalidateTeamSurfaces();
}

export async function assignConversationAction(formData: FormData) {
  const { claims } = await requireActiveMembership();

  if (!canChangeAssignment(claims.role)) {
    return;
  }

  const parsed = assignmentSchema.safeParse({
    conversationId: readString(formData, "conversationId"),
    assigneeId: readString(formData, "assigneeId") || null,
    reason: readString(formData, "reason") || undefined,
  });

  if (!parsed.success) {
    return;
  }

  const conversation = await db.conversation.findUnique({
    where: { id: parsed.data.conversationId },
    select: {
      id: true,
      workspaceId: true,
      currentAssigneeId: true,
      ownershipVersion: true,
    },
  });

  if (!conversation || conversation.workspaceId !== claims.workspaceId) {
    return;
  }

  let nextAssigneeUserId: string | null = null;

  if (parsed.data.assigneeId) {
    const assigneeMembership = await db.workspaceMember.findUnique({
      where: { id: parsed.data.assigneeId },
      select: {
        id: true,
        workspaceId: true,
        userId: true,
        role: true,
        status: true,
      },
    });

    if (
      !assigneeMembership ||
      assigneeMembership.workspaceId !== claims.workspaceId ||
      assigneeMembership.status !== "ACTIVE" ||
      !canBeAssigned(assigneeMembership.role)
    ) {
      return;
    }

    nextAssigneeUserId = assigneeMembership.userId;
  }

  if (conversation.currentAssigneeId === nextAssigneeUserId) {
    return;
  }

  const action =
    !conversation.currentAssigneeId && nextAssigneeUserId
      ? "ASSIGNED"
      : conversation.currentAssigneeId && !nextAssigneeUserId
        ? "UNASSIGNED"
        : "REASSIGNED";

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        currentAssigneeId: nextAssigneeUserId,
        ownershipVersion: {
          increment: 1,
        },
      },
    });

    await tx.assignmentEvent.create({
      data: {
        workspaceId: claims.workspaceId,
        conversationId: conversation.id,
        action,
        fromUserId: conversation.currentAssigneeId,
        toUserId: nextAssigneeUserId,
        actorUserId: claims.sub,
        reason: parsed.data.reason,
      },
    });

    await tx.auditLog.create({
      data: {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        action: action === "UNASSIGNED" ? "CONVERSATION_UNASSIGNED" : "CONVERSATION_ASSIGNED",
        entityType: "conversation",
        entityId: conversation.id,
        metadata: {
          fromUserId: conversation.currentAssigneeId,
          toUserId: nextAssigneeUserId,
          reason: parsed.data.reason,
        },
      },
    });
  });

  revalidateTeamSurfaces();
}
