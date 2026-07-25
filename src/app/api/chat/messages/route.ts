import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { generatePolicyAwareReply } from "@/modules/chat/agent-reply";
import { readBearerToken, verifyVisitorToken } from "@/modules/chat/auth";
import { chatLog } from "@/modules/chat/log";

async function resolveActor(request: Request) {
  const bearer = readBearerToken(request.headers.get("authorization"));
  if (bearer) {
    const visitor = await verifyVisitorToken(bearer);
    if (visitor) {
      return { kind: "VISITOR" as const, visitor };
    }
  }

  const claims = await getSessionClaims();
  if (claims) {
    return { kind: "AGENT" as const, claims };
  }

  return null;
}

async function maybeGenerateAutoReply(input: {
  conversationId: string;
  workspaceId: string;
  workspaceName: string;
  latestVisitorText: string;
}) {
  await db.chatTypingState.deleteMany({
    where: {
      conversationId: input.conversationId,
      actorType: "AGENT",
      actorUserId: null,
    },
  });

  await db.chatTypingState.create({
    data: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      actorType: "AGENT",
      actorUserId: null,
    },
  });

  try {
    const onlineAgents = await db.workspaceMember.count({
      where: {
        workspaceId: input.workspaceId,
        status: "ACTIVE",
        lastSeenAt: { gte: new Date(Date.now() - 45_000) },
      },
    });

    if (onlineAgents > 0) {
      chatLog("info", "ai_reply_skipped_agents_online", {
        conversationId: input.conversationId,
      });
      return;
    }

    const recentMessages = await db.chatMessage.findMany({
      where: { conversationId: input.conversationId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        senderType: true,
        body: true,
        senderUser: {
          select: { fullName: true },
        },
      },
    });

    const aiReply = await generatePolicyAwareReply({
      workspaceName: input.workspaceName,
      latestVisitorMessage: input.latestVisitorText,
      recentMessages: recentMessages.reverse().map((message) => ({
        senderType: message.senderType,
        body: message.body,
        senderName: message.senderUser?.fullName,
      })),
    });

    if (aiReply.kind === "handoff") {
      chatLog("info", "ai_reply_handoff", {
        conversationId: input.conversationId,
        reason: aiReply.reason,
      });
      return;
    }

    if (aiReply.kind !== "reply") {
      chatLog("info", "ai_reply_skipped", {
        conversationId: input.conversationId,
        reason: aiReply.reason,
      });
      return;
    }

    const now = new Date();
    await db.$transaction([
      db.chatMessage.create({
        data: {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          senderType: "AGENT",
          senderUserId: null,
          body: aiReply.body,
          readByVisitorAt: null,
          readByAgentAt: now,
        },
      }),
      db.conversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: now },
      }),
    ]);

    chatLog("info", "ai_reply_sent", {
      conversationId: input.conversationId,
      model: aiReply.model,
    });
  } catch (error) {
    chatLog("warn", "ai_reply_workflow_failed", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  } finally {
    await db.chatTypingState.deleteMany({
      where: {
        conversationId: input.conversationId,
        actorType: "AGENT",
        actorUserId: null,
      },
    });
  }
}

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request);
    if (!actor) {
      chatLog("warn", "messages_get_unauthorized");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId");
    if (!conversationId) {
      chatLog("warn", "messages_get_missing_conversation");
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, workspaceId: true, visitorLastSeenAt: true },
    });

    if (!conversation) {
      chatLog("warn", "messages_get_conversation_not_found", { conversationId });
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    if (actor.kind === "VISITOR") {
      if (actor.visitor.conversationId !== conversation.id || actor.visitor.workspaceId !== conversation.workspaceId) {
        chatLog("warn", "messages_get_forbidden_visitor", { conversationId: conversation.id });
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      await Promise.all([
        db.conversation.update({
          where: { id: conversation.id },
          data: { visitorLastSeenAt: new Date() },
        }),
        db.chatMessage.updateMany({
          where: {
            conversationId: conversation.id,
            senderType: "AGENT",
            readByVisitorAt: null,
          },
          data: { readByVisitorAt: new Date() },
        }),
      ]);
    }

    if (actor.kind === "AGENT") {
      const membership = await db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: conversation.workspaceId,
            userId: actor.claims.sub,
          },
        },
        select: { id: true, status: true },
      });

      if (!membership || membership.status !== "ACTIVE") {
        chatLog("warn", "messages_get_forbidden_agent", {
          conversationId: conversation.id,
          userId: actor.claims.sub,
        });
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
    }

    const [messages, typing, onlineAgents, refreshedConversation] = await Promise.all([
      db.chatMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "asc" },
        take: 200,
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
      }),
      db.chatTypingState.findMany({
        where: {
          conversationId: conversation.id,
          updatedAt: { gte: new Date(Date.now() - 6_000) },
        },
        select: { actorType: true, actorUserId: true, updatedAt: true },
      }),
      db.workspaceMember.count({
        where: {
          workspaceId: conversation.workspaceId,
          status: "ACTIVE",
          lastSeenAt: { gte: new Date(Date.now() - 45_000) },
        },
      }),
      db.conversation.findUnique({
        where: { id: conversation.id },
        select: { visitorLastSeenAt: true },
      }),
    ]);

    const viewerUserId = actor.kind === "AGENT" ? actor.claims.sub : null;

    return NextResponse.json({
      messages,
      meta: {
        agentOnline: onlineAgents > 0,
        visitorOnline:
          refreshedConversation?.visitorLastSeenAt != null &&
          refreshedConversation.visitorLastSeenAt.getTime() > Date.now() - 45_000,
        visitorTyping: typing.some((entry) => entry.actorType === "VISITOR"),
        agentTyping:
          actor.kind === "AGENT"
            ? typing.some((entry) => entry.actorType === "AGENT" && entry.actorUserId !== viewerUserId)
            : typing.some((entry) => entry.actorType === "AGENT"),
      },
    });
  } catch (error) {
    chatLog("error", "messages_get_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    if (!actor) {
      chatLog("warn", "messages_post_unauthorized");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          conversationId?: string;
          text?: string;
        }
      | null;

    const conversationId = body?.conversationId;
    const text = body?.text?.trim();

    if (!conversationId || !text) {
      chatLog("warn", "messages_post_invalid_body");
      return NextResponse.json({ error: "conversationId and text are required" }, { status: 400 });
    }

    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, workspaceId: true, channel: true, workspace: { select: { name: true } } },
    });

    if (!conversation) {
      chatLog("warn", "messages_post_conversation_not_found", { conversationId });
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    if (actor.kind === "VISITOR") {
      if (actor.visitor.conversationId !== conversation.id || actor.visitor.workspaceId !== conversation.workspaceId) {
        chatLog("warn", "messages_post_forbidden_visitor", { conversationId: conversation.id });
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    let senderUserId: string | null = null;
    if (actor.kind === "AGENT") {
      const membership = await db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: conversation.workspaceId,
            userId: actor.claims.sub,
          },
        },
        select: { id: true, status: true },
      });

      if (!membership || membership.status !== "ACTIVE") {
        chatLog("warn", "messages_post_forbidden_agent", {
          conversationId: conversation.id,
          userId: actor.claims.sub,
        });
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      senderUserId = actor.claims.sub;

      await db.workspaceMember.update({
        where: { id: membership.id },
        data: { lastSeenAt: new Date() },
      });
    }

    const now = new Date();
    const message = await db.chatMessage.create({
      data: {
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        senderType: actor.kind,
        senderUserId,
        body: text,
        readByVisitorAt: actor.kind === "VISITOR" ? now : null,
        readByAgentAt: actor.kind === "AGENT" ? now : null,
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
    });

    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        updatedAt: now,
        visitorLastSeenAt: actor.kind === "VISITOR" ? now : undefined,
      },
    });

    if (actor.kind === "VISITOR" && conversation.channel === "CHAT_WIDGET") {
      await maybeGenerateAutoReply({
        conversationId: conversation.id,
        workspaceId: conversation.workspaceId,
        workspaceName: conversation.workspace.name,
        latestVisitorText: text,
      });
    }

    return NextResponse.json({ message });
  } catch (error) {
    chatLog("error", "messages_post_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
