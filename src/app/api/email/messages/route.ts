import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { withApiLogging } from "@/modules/observability/api";

async function GETHandler(request: Request) {
  try {
    const claims = await getSessionClaims();
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const conversationId = new URL(request.url).searchParams.get("conversationId");
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, workspaceId: true, channel: true },
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

    await db.chatMessage.updateMany({
      where: {
        conversationId: conversation.id,
        senderType: "VISITOR",
        readByAgentAt: null,
      },
      data: { readByAgentAt: new Date() },
    });

    const messages = await db.chatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      take: 500,
      select: {
        id: true,
        senderType: true,
        senderUserId: true,
        body: true,
        createdAt: true,
        readByVisitorAt: true,
        readByAgentAt: true,
        senderUser: {
          select: { fullName: true },
        },
      },
    });

    return NextResponse.json({ messages });
  } catch (error) {
    chatLog("error", "email_messages_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const GET = withApiLogging(GETHandler, "GET src/app/api/email/messages");
