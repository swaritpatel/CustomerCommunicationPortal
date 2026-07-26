import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { buildAutoReplyDraft } from "@/modules/email/ai-draft";
import { withApiLogging } from "@/modules/observability/api";

type DraftMessageItem = {
  senderType: "VISITOR" | "AGENT" | "SYSTEM";
  body: string;
};

async function POSTHandler(request: Request) {
  try {
    const claims = await getSessionClaims();
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { conversationId?: string; cannedResponses?: string[] }
      | null;

    const conversationId = body?.conversationId;
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        workspaceId: true,
        channel: true,
        subject: true,
        customerName: true,
      },
    });

    if (!conversation || conversation.channel !== "EMAIL") {
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

    const messages: DraftMessageItem[] = await db.chatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: {
        senderType: true,
        body: true,
      },
    });

    const draft = buildAutoReplyDraft({
      subject: conversation.subject,
      customerName: conversation.customerName,
      recentMessages: messages,
      cannedResponses: Array.isArray(body?.cannedResponses) ? body.cannedResponses : [],
    });

    return NextResponse.json({ draft });
  } catch (error) {
    chatLog("error", "email_draft_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiLogging(POSTHandler, "POST src/app/api/email/draft");
