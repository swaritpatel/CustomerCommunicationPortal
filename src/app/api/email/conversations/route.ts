import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";

export async function GET() {
  try {
    const claims = await getSessionClaims();
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await db.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: claims.workspaceId,
          userId: claims.sub,
        },
      },
      select: { id: true, status: true },
    });

    if (!membership || membership.status !== "ACTIVE") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const conversations = await db.conversation.findMany({
      where: {
        workspaceId: claims.workspaceId,
        channel: "EMAIL",
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        subject: true,
        customerName: true,
        customerEmail: true,
        status: true,
        updatedAt: true,
        currentAssigneeId: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, createdAt: true, senderType: true },
        },
        _count: {
          select: {
            messages: {
              where: {
                senderType: "VISITOR",
                readByAgentAt: null,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        subject: conversation.subject,
        customerName: conversation.customerName,
        customerEmail: conversation.customerEmail,
        status: conversation.status,
        updatedAt: conversation.updatedAt,
        currentAssigneeId: conversation.currentAssigneeId,
        unreadCount: conversation._count.messages,
        latestMessage: conversation.messages[0] ?? null,
      })),
    });
  } catch (error) {
    chatLog("error", "email_conversations_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
