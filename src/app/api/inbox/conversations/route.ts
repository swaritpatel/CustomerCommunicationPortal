import { NextResponse } from "next/server";
import type { ConversationChannel, ConversationStatus, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";

const FIRST_RESPONSE_TARGET_MINUTES = 15;
const RESOLUTION_TARGET_HOURS = 24;
const channels = ["EMAIL", "CHAT_WIDGET"] as const;
const statuses = ["OPEN", "SNOOZED", "RESOLVED"] as const;

type SlaMessageItem = {
  senderType: string;
  createdAt: Date;
};

type InboxMemberItem = {
  userId: string;
  role: string;
  user: {
    id: string;
    fullName: string;
    email: string;
  };
};

type InboxConversationListItem = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  subject: string;
  channel: ConversationChannel;
  customerName: string | null;
  customerEmail: string | null;
  visitorLastSeenAt: Date | null;
  status: ConversationStatus;
  currentAssigneeId: string | null;
  currentAssignee: { id: string; fullName: string; email: string } | null;
  messages: Array<{ body: string; senderType: string; createdAt: Date }>;
  _count: { messages: number };
};

function parseChannel(value: string | null): ConversationChannel | null {
  return channels.some((channel: (typeof channels)[number]) => channel === value) ? (value as ConversationChannel) : null;
}

function parseStatus(value: string | null): ConversationStatus | null {
  return statuses.some((status: (typeof statuses)[number]) => status === value) ? (value as ConversationStatus) : null;
}

function buildSla(conversation: {
  createdAt: Date;
  updatedAt: Date;
  status: ConversationStatus;
  messages: SlaMessageItem[];
}) {
  const firstVisitor = conversation.messages.find((message: SlaMessageItem) => message.senderType === "VISITOR");
  const firstAgent = conversation.messages.find((message: SlaMessageItem) => message.senderType === "AGENT");
  const now = Date.now();

  const firstResponseMinutes =
    firstVisitor && firstAgent
      ? (firstAgent.createdAt.getTime() - firstVisitor.createdAt.getTime()) / (1000 * 60)
      : firstVisitor
        ? (now - firstVisitor.createdAt.getTime()) / (1000 * 60)
        : null;

  const resolutionHours =
    conversation.status === "RESOLVED"
      ? (conversation.updatedAt.getTime() - conversation.createdAt.getTime()) / (1000 * 60 * 60)
      : (now - conversation.createdAt.getTime()) / (1000 * 60 * 60);

  return {
    firstResponseMinutes,
    firstResponseBreach:
      firstResponseMinutes !== null && firstResponseMinutes > FIRST_RESPONSE_TARGET_MINUTES,
    resolutionHours,
    resolutionBreach: resolutionHours > RESOLUTION_TARGET_HOURS,
  };
}

export async function GET(request: Request) {
  try {
    const claims = await getSessionClaims();
    if (!claims) {
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
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db.workspaceMember.update({
      where: { id: membership.id },
      data: { lastSeenAt: new Date() },
    });

    const params = new URL(request.url).searchParams;
    const channel = parseChannel(params.get("channel"));
    const status = parseStatus(params.get("status"));
    const assignee = params.get("assignee");

    const assigneeWhere: Prisma.ConversationWhereInput =
      assignee === "ME"
        ? { currentAssigneeId: claims.sub }
        : assignee === "UNASSIGNED"
          ? { currentAssigneeId: null }
          : assignee && assignee !== "ALL"
            ? { currentAssigneeId: assignee }
            : {};

    const [conversations, members]: [InboxConversationListItem[], InboxMemberItem[]] = await Promise.all([
      db.conversation.findMany({
        where: {
          workspaceId: claims.workspaceId,
          ...(channel ? { channel } : {}),
          ...(status ? { status } : {}),
          ...assigneeWhere,
        } satisfies Prisma.ConversationWhereInput,
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          subject: true,
          channel: true,
          customerName: true,
          customerEmail: true,
          visitorLastSeenAt: true,
          status: true,
          currentAssigneeId: true,
          currentAssignee: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          messages: {
            orderBy: { createdAt: "asc" },
            take: 100,
            select: { body: true, senderType: true, createdAt: true },
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
      }),
      db.workspaceMember.findMany({
        where: {
          workspaceId: claims.workspaceId,
          status: "ACTIVE",
        },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: {
          userId: true,
          role: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      }),
    ]);

    return NextResponse.json({
      viewer: {
        id: claims.sub,
        role: claims.role,
      },
      members: members.map((member: InboxMemberItem) => ({
        id: member.userId,
        fullName: member.user.fullName,
        email: member.user.email,
        role: member.role,
      })),
      conversations: conversations.map((conversation: InboxConversationListItem) => {
        const latestMessage =
          conversation.messages.length > 0 ? conversation.messages[conversation.messages.length - 1] : null;
        const sla = buildSla(conversation);

        return {
          id: conversation.id,
          subject: conversation.subject,
          channel: conversation.channel,
          customerName: conversation.customerName,
          customerEmail: conversation.customerEmail,
          status: conversation.status,
          updatedAt: conversation.updatedAt,
          createdAt: conversation.createdAt,
          currentAssigneeId: conversation.currentAssigneeId,
          currentAssignee: conversation.currentAssignee,
          unreadCount: conversation._count.messages,
          latestMessage,
          visitorOnline:
            conversation.visitorLastSeenAt != null &&
            conversation.visitorLastSeenAt.getTime() > Date.now() - 45_000,
          sla,
        };
      }),
    });
  } catch (error) {
    chatLog("error", "inbox_conversations_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
