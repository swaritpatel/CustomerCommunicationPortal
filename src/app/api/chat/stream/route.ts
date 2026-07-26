import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { readBearerToken, verifyVisitorToken } from "@/modules/chat/auth";
import { chatLog } from "@/modules/chat/log";
import { withApiLogging } from "@/modules/observability/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatTypingEntry = {
  actorType: "VISITOR" | "AGENT";
  actorUserId: string | null;
};

type SnapshotMessageItem = {
  id: string;
  senderType: "VISITOR" | "AGENT" | "SYSTEM";
  senderUserId: string | null;
  body: string;
  createdAt: Date;
  readByVisitorAt: Date | null;
  readByAgentAt: Date | null;
  senderUser: { fullName: string } | null;
};

async function resolveActor(request: Request) {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  const bearer = readBearerToken(request.headers.get("authorization")) ?? queryToken;
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

async function buildSnapshot(
  conversationId: string,
  workspaceId: string,
  viewerKind: "AGENT" | "VISITOR",
  viewerUserId: string | null,
) {
  const [messages, typing, onlineAgents, refreshedConversation]: [
    SnapshotMessageItem[],
    ChatTypingEntry[],
    number,
    { visitorLastSeenAt: Date | null } | null,
  ] = await Promise.all([
    db.chatMessage.findMany({
      where: { conversationId },
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
        conversationId,
        updatedAt: { gte: new Date(Date.now() - 6_000) },
      },
      select: { actorType: true, actorUserId: true },
    }),
    db.workspaceMember.count({
      where: {
        workspaceId,
        status: "ACTIVE",
        lastSeenAt: { gte: new Date(Date.now() - 45_000) },
      },
    }),
    db.conversation.findUnique({
      where: { id: conversationId },
      select: { visitorLastSeenAt: true },
    }),
  ]);

  return {
    messages,
    meta: {
      agentOnline: onlineAgents > 0,
      visitorOnline:
        refreshedConversation?.visitorLastSeenAt != null &&
        refreshedConversation.visitorLastSeenAt.getTime() > Date.now() - 45_000,
      visitorTyping: typing.some((entry: ChatTypingEntry) => entry.actorType === "VISITOR"),
      agentTyping:
        viewerKind === "AGENT"
          ? typing.some((entry: ChatTypingEntry) => entry.actorType === "AGENT" && entry.actorUserId !== viewerUserId)
          : typing.some((entry: ChatTypingEntry) => entry.actorType === "AGENT"),
    },
  };
}

function toFingerprint(snapshot: Awaited<ReturnType<typeof buildSnapshot>>) {
  const lastMessage = snapshot.messages[snapshot.messages.length - 1];
  return JSON.stringify({
    count: snapshot.messages.length,
    lastId: lastMessage?.id ?? null,
    lastVisitorReadAt: lastMessage?.readByVisitorAt ?? null,
    lastAgentReadAt: lastMessage?.readByAgentAt ?? null,
    meta: snapshot.meta,
  });
}

async function GETHandler(request: Request) {
  try {
    const actor = await resolveActor(request);
    if (!actor) {
      chatLog("warn", "stream_unauthorized");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId");

    if (!conversationId) {
      chatLog("warn", "stream_missing_conversation");
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, workspaceId: true, visitorLastSeenAt: true },
    });

    if (!conversation) {
      chatLog("warn", "stream_conversation_not_found", { conversationId });
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    let membershipId: string | null = null;
    let membershipLastSeenAt: Date | null = null;

    if (actor.kind === "VISITOR") {
      if (actor.visitor.conversationId !== conversation.id || actor.visitor.workspaceId !== conversation.workspaceId) {
        chatLog("warn", "stream_forbidden_visitor", { conversationId: conversation.id });
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (actor.kind === "AGENT") {
      const membership = await db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: conversation.workspaceId,
            userId: actor.claims.sub,
          },
        },
        select: { id: true, status: true, lastSeenAt: true },
      });

      if (!membership || membership.status !== "ACTIVE") {
        chatLog("warn", "stream_forbidden_agent", {
          conversationId: conversation.id,
          userId: actor.claims.sub,
        });
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      membershipId = membership.id;
      membershipLastSeenAt = membership.lastSeenAt;
    }

    const encoder = new TextEncoder();
    const headers = {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    };

    let stopStream = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
      let closed = false;
      let syncing = false;
      let lastFingerprint = "";

      const send = (event: string, payload: unknown) => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          close();
        }
      };

      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeatInterval);
        clearInterval(syncInterval);
        try {
          controller.close();
        } catch {
          // The browser may already have closed the stream.
        }
      };
      stopStream = close;

      const runSync = async () => {
        if (closed || syncing) {
          return;
        }

        syncing = true;
        try {
          const now = Date.now();

          if (actor.kind === "VISITOR") {
            if (
              !conversation.visitorLastSeenAt ||
              conversation.visitorLastSeenAt.getTime() < now - 15_000
            ) {
              conversation.visitorLastSeenAt = new Date(now);
              await db.conversation.update({
                where: { id: conversation.id },
                data: { visitorLastSeenAt: conversation.visitorLastSeenAt },
              });
            }

            await db.chatMessage.updateMany({
              where: {
                conversationId: conversation.id,
                senderType: "AGENT",
                readByVisitorAt: null,
              },
              data: { readByVisitorAt: new Date(now) },
            });
          }

          if (actor.kind === "AGENT" && membershipId) {
            if (!membershipLastSeenAt || membershipLastSeenAt.getTime() < now - 15_000) {
              membershipLastSeenAt = new Date(now);
              await db.workspaceMember.update({
                where: { id: membershipId },
                data: { lastSeenAt: membershipLastSeenAt },
              });
            }

            await db.chatMessage.updateMany({
              where: {
                conversationId: conversation.id,
                senderType: "VISITOR",
                readByAgentAt: null,
              },
              data: { readByAgentAt: new Date(now) },
            });
          }

          const snapshot = await buildSnapshot(
            conversation.id,
            conversation.workspaceId,
            actor.kind,
            actor.kind === "AGENT" ? actor.claims.sub : null,
          );
          if (closed) {
            return;
          }
          const fingerprint = toFingerprint(snapshot);
          if (fingerprint !== lastFingerprint) {
            lastFingerprint = fingerprint;
            send("snapshot", snapshot);
          }
        } catch (error) {
          if (closed) {
            return;
          }
          chatLog("error", "stream_sync_failed", {
            conversationId: conversation.id,
            error: error instanceof Error ? error.message : "unknown_error",
          });
          send("error", { message: "sync_failed" });
        } finally {
          syncing = false;
        }
      };

      const heartbeatInterval = setInterval(() => {
        send("heartbeat", { timestamp: Date.now() });
      }, 15_000);

      const syncInterval = setInterval(() => {
        void runSync();
      }, 2_500);

      request.signal.addEventListener("abort", () => {
        chatLog("info", "stream_aborted", { conversationId: conversation.id });
        close();
      });
      void runSync();
      },
      cancel() {
        chatLog("info", "stream_cancelled", { conversationId: conversation.id });
        stopStream();
        return;
      },
    });

    return new Response(stream, { headers });
  } catch (error) {
    chatLog("error", "stream_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const GET = withApiLogging(GETHandler, "GET src/app/api/chat/stream");
