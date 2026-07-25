import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";

export async function GET(request: Request) {
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
      select: {
        id: true,
        workspaceId: true,
        channel: true,
        customerEmail: true,
        customerName: true,
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

    await Promise.all([
      db.workspaceMember.update({
        where: { id: membership.id },
        data: { lastSeenAt: new Date() },
      }),
      db.chatMessage.updateMany({
        where: {
          conversationId: conversation.id,
          senderType: "VISITOR",
          readByAgentAt: null,
        },
        data: { readByAgentAt: new Date() },
      }),
    ]);

    const [messages, timeline] = await Promise.all([
      db.chatMessage.findMany({
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
            select: {
              fullName: true,
            },
          },
        },
      }),
      conversation.customerEmail
        ? db.conversation.findMany({
            where: {
              workspaceId: conversation.workspaceId,
              customerEmail: conversation.customerEmail,
            },
            orderBy: { createdAt: "desc" },
            take: 8,
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
          })
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      messages,
      timeline: timeline.map((item) => ({
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
    chatLog("error", "inbox_messages_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
