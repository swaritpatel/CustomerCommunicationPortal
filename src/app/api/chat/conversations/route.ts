import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { withApiLogging } from "@/modules/observability/api";

type ChatConversationListItem = {
  id: string;
  subject: string;
  customerName: string | null;
  customerEmail: string | null;
  status: string;
  updatedAt: Date;
  visitorLastSeenAt: Date | null;
  messages: Array<{ body: string; createdAt: Date; senderType: string }>;
  _count: { messages: number };
};

async function GETHandler() {
  try {
    const claims = await getSessionClaims();
    if (!claims) {
      chatLog("warn", "conversations_unauthorized");
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
      chatLog("warn", "conversations_forbidden", {
        workspaceId: claims.workspaceId,
        userId: claims.sub,
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db.workspaceMember.update({
      where: { id: membership.id },
      data: { lastSeenAt: new Date() },
    });

    const conversations: ChatConversationListItem[] = await db.conversation.findMany({
      where: {
        workspaceId: claims.workspaceId,
        channel: "CHAT_WIDGET",
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        subject: true,
        customerName: true,
        customerEmail: true,
        status: true,
        updatedAt: true,
        visitorLastSeenAt: true,
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
      conversations: conversations.map((conversation: ChatConversationListItem) => ({
        id: conversation.id,
        subject: conversation.subject,
        customerName: conversation.customerName,
        customerEmail: conversation.customerEmail,
        status: conversation.status,
        updatedAt: conversation.updatedAt,
        visitorOnline:
          conversation.visitorLastSeenAt != null &&
          conversation.visitorLastSeenAt.getTime() > Date.now() - 45_000,
        unreadCount: conversation._count.messages,
        latestMessage: conversation.messages[0] ?? null,
      })),
    });
  } catch (error) {
    chatLog("error", "conversations_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const GET = withApiLogging(GETHandler, "GET src/app/api/chat/conversations");
