import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { summarizeConversation } from "@/modules/inbox/ai-summary";
import { withApiLogging } from "@/modules/observability/api";

type SummaryMessageItem = {
  senderType: "VISITOR" | "AGENT" | "SYSTEM";
  body: string;
  createdAt: Date;
  senderUser: { fullName: string } | null;
};

async function POSTHandler(request: Request) {
  try {
    const claims = await getSessionClaims();
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as { conversationId?: string } | null;
    const conversationId = body?.conversationId;
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        workspaceId: true,
        subject: true,
        customerName: true,
        customerEmail: true,
        workspace: {
          select: { name: true },
        },
      },
    });

    if (!conversation || conversation.workspaceId !== claims.workspaceId) {
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

    const messages: SummaryMessageItem[] = await db.chatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      take: 120,
      select: {
        senderType: true,
        body: true,
        createdAt: true,
        senderUser: {
          select: { fullName: true },
        },
      },
    });

    const summary = await summarizeConversation({
      workspaceName: conversation.workspace.name,
      subject: conversation.subject,
      customerName: conversation.customerName,
      customerEmail: conversation.customerEmail,
      messages: messages.map((message: SummaryMessageItem) => ({
        senderType: message.senderType,
        body: message.body,
        createdAt: message.createdAt,
        senderName: message.senderUser?.fullName,
      })),
    });

    return NextResponse.json({ summary });
  } catch (error) {
    chatLog("error", "inbox_summary_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiLogging(POSTHandler, "POST src/app/api/inbox/summary");
