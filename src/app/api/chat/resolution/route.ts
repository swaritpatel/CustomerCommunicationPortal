import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { readBearerToken, verifyVisitorToken } from "@/modules/chat/auth";
import { chatLog } from "@/modules/chat/log";
import { withApiLogging } from "@/modules/observability/api";
import { broadcastConversationEvent } from "@/modules/realtime/broadcast";

async function POSTHandler(request: Request) {
  try {
    const bearer = readBearerToken(request.headers.get("authorization"));
    const visitor = bearer ? await verifyVisitorToken(bearer) : null;

    if (!visitor) {
      chatLog("warn", "chat_resolution_unauthorized");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          conversationId?: string;
          resolved?: boolean;
        }
      | null;

    if (!body?.conversationId || typeof body.resolved !== "boolean") {
      chatLog("warn", "chat_resolution_invalid_body", {
        conversationId: body?.conversationId,
      });
      return NextResponse.json({ error: "conversationId and resolved are required" }, { status: 400 });
    }

    if (visitor.conversationId !== body.conversationId) {
      chatLog("warn", "chat_resolution_forbidden_visitor", {
        conversationId: body.conversationId,
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const conversation = await db.conversation.findUnique({
      where: { id: body.conversationId },
      select: { id: true, workspaceId: true },
    });

    if (!conversation || conversation.workspaceId !== visitor.workspaceId) {
      chatLog("warn", "chat_resolution_conversation_not_found", {
        conversationId: body.conversationId,
      });
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const now = new Date();
    const messageBody = body.resolved
      ? "Yes, this resolved my issue."
      : "No, my issue is not resolved. Please keep this ticket open.";

    const [message] = await db.$transaction([
      db.chatMessage.create({
        data: {
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          senderType: "VISITOR",
          senderUserId: null,
          body: messageBody,
          readByVisitorAt: now,
          readByAgentAt: null,
        },
        select: {
          id: true,
          senderType: true,
          senderUserId: true,
          body: true,
          createdAt: true,
          readByVisitorAt: true,
          readByAgentAt: true,
        },
      }),
      db.conversation.update({
        where: { id: conversation.id },
        data: {
          status: body.resolved ? "RESOLVED" : "OPEN",
          visitorLastSeenAt: now,
          updatedAt: now,
        },
      }),
    ]);

    await broadcastConversationEvent({
      type: "message.created",
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
    });
    await broadcastConversationEvent({
      type: "conversation.updated",
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
    });

    chatLog("info", "chat_resolution_recorded", {
      conversationId: conversation.id,
      resolved: body.resolved,
    });

    return NextResponse.json({
      ok: true,
      status: body.resolved ? "RESOLVED" : "OPEN",
      message,
    });
  } catch (error) {
    chatLog("error", "chat_resolution_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiLogging(POSTHandler, "POST src/app/api/chat/resolution");
