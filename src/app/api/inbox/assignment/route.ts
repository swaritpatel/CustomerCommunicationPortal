import { NextResponse } from "next/server";

import { db, type DbTransactionClient } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { withApiLogging } from "@/modules/observability/api";

async function POSTHandler(request: Request) {
  try {
    const claims = await getSessionClaims();
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (claims.role !== "ADMIN") {
      return NextResponse.json({ error: "Only admins can change assignments" }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as
      | { conversationId?: string; assigneeId?: string | null; reason?: string }
      | null;

    const conversationId = body?.conversationId;
    const assigneeId = body?.assigneeId?.trim() || null;
    const reason = body?.reason?.trim().slice(0, 240) || undefined;

    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        workspaceId: true,
        currentAssigneeId: true,
      },
    });

    if (!conversation || conversation.workspaceId !== claims.workspaceId) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    let nextAssigneeUserId: string | null = null;

    if (assigneeId) {
      const assignee = await db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: claims.workspaceId,
            userId: assigneeId,
          },
        },
        select: { userId: true, status: true },
      });

      if (!assignee || assignee.status !== "ACTIVE") {
        return NextResponse.json({ error: "Assignee is not an active member" }, { status: 400 });
      }

      nextAssigneeUserId = assignee.userId;
    }

    if (conversation.currentAssigneeId === nextAssigneeUserId) {
      return NextResponse.json({ ok: true, assigneeId: nextAssigneeUserId });
    }

    const action =
      !conversation.currentAssigneeId && nextAssigneeUserId
        ? "ASSIGNED"
        : conversation.currentAssigneeId && !nextAssigneeUserId
          ? "UNASSIGNED"
          : "REASSIGNED";

    await db.$transaction(async (tx: DbTransactionClient) => {
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          currentAssigneeId: nextAssigneeUserId,
          ownershipVersion: { increment: 1 },
          updatedAt: new Date(),
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
          reason,
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
            reason,
          },
        },
      });
    });

    return NextResponse.json({ ok: true, assigneeId: nextAssigneeUserId });
  } catch (error) {
    chatLog("error", "inbox_assignment_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiLogging(POSTHandler, "POST src/app/api/inbox/assignment");
