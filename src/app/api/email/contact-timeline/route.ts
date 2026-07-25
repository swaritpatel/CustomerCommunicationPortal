import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";

type ContactTimelineItem = {
  id: string;
  subject: string;
  channel: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{ body: string; senderType: string; createdAt: Date }>;
};

export async function GET(request: Request) {
  try {
    const claims = await getSessionClaims();
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = new URL(request.url).searchParams;
    const conversationId = params.get("conversationId");

    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        workspaceId: true,
        customerEmail: true,
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const membership = await db.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: conversation.workspaceId,
          userId: claims.sub,
        },
      },
      select: { id: true, status: true },
    });

    if (!membership || membership.status !== "ACTIVE") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!conversation.customerEmail) {
      return NextResponse.json({ events: [] });
    }

    const history: ContactTimelineItem[] = await db.conversation.findMany({
      where: {
        workspaceId: conversation.workspaceId,
        customerEmail: conversation.customerEmail,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        subject: true,
        channel: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, senderType: true, createdAt: true },
        },
      },
    });

    return NextResponse.json({
      customerEmail: conversation.customerEmail,
      events: history.map((item: ContactTimelineItem) => ({
        conversationId: item.id,
        subject: item.subject,
        channel: item.channel,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        latestMessage: item.messages[0] ?? null,
      })),
    });
  } catch (error) {
    chatLog("error", "email_contact_timeline_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
