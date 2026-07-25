import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { readBearerToken, verifyVisitorToken } from "@/modules/chat/auth";
import { chatLog } from "@/modules/chat/log";
import { broadcastConversationEvent } from "@/modules/realtime/broadcast";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { conversationId?: string; isTyping?: boolean }
      | null;

    if (!body?.conversationId) {
      chatLog("warn", "typing_missing_conversation");
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const conversation = await db.conversation.findUnique({
      where: { id: body.conversationId },
      select: { id: true, workspaceId: true },
    });

    if (!conversation) {
      chatLog("warn", "typing_conversation_not_found", { conversationId: body.conversationId });
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const bearer = readBearerToken(request.headers.get("authorization"));
    const visitor = bearer ? await verifyVisitorToken(bearer) : null;

    if (visitor) {
      if (visitor.conversationId !== conversation.id || visitor.workspaceId !== conversation.workspaceId) {
        chatLog("warn", "typing_forbidden_visitor", { conversationId: conversation.id });
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      await db.chatTypingState.deleteMany({
        where: {
          conversationId: conversation.id,
          actorType: "VISITOR",
        },
      });

      if (body.isTyping) {
        await db.chatTypingState.create({
          data: {
            workspaceId: conversation.workspaceId,
            conversationId: conversation.id,
            actorType: "VISITOR",
          },
        });
      }

      await broadcastConversationEvent({
        type: "typing.updated",
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
      });

      return NextResponse.json({ ok: true });
    }

    const claims = await getSessionClaims();
    if (!claims) {
      chatLog("warn", "typing_unauthorized");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      chatLog("warn", "typing_forbidden_agent", {
        conversationId: conversation.id,
        userId: claims.sub,
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db.workspaceMember.update({
      where: { id: membership.id },
      data: { lastSeenAt: new Date() },
    });

    await db.chatTypingState.deleteMany({
      where: {
        conversationId: conversation.id,
        actorType: "AGENT",
        actorUserId: claims.sub,
      },
    });

    if (body.isTyping) {
      await db.chatTypingState.create({
        data: {
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          actorType: "AGENT",
          actorUserId: claims.sub,
        },
      });
    }

    await broadcastConversationEvent({
      type: "typing.updated",
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    chatLog("error", "typing_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
