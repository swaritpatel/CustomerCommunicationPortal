import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";

const FIRST_RESPONSE_TARGET_MINUTES = 15;
const RESOLUTION_TARGET_HOURS = 24;

type AnalyticsMessageItem = {
  senderType: string;
  createdAt: Date;
};

type InboxAnalyticsConversation = {
  id: string;
  channel: "EMAIL" | "CHAT_WIDGET";
  status: "OPEN" | "SNOOZED" | "RESOLVED";
  createdAt: Date;
  updatedAt: Date;
  currentAssigneeId: string | null;
  messages: AnalyticsMessageItem[];
};

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

export async function GET() {
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

    const conversations: InboxAnalyticsConversation[] = await db.conversation.findMany({
      where: { workspaceId: claims.workspaceId },
      select: {
        id: true,
        channel: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        currentAssigneeId: true,
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            senderType: true,
            createdAt: true,
          },
        },
      },
    });

    const firstResponseMinutes: number[] = [];
    const resolutionHours: number[] = [];
    const busiestHourMap = new Map<number, number>();
    const agentLoadMap = new Map<string, number>();
    const byChannel = { EMAIL: 0, CHAT_WIDGET: 0 };
    const byStatus = { OPEN: 0, SNOOZED: 0, RESOLVED: 0 };

    let firstResponseBreaches = 0;
    let resolutionBreaches = 0;

    for (const conversation of conversations) {
      byChannel[conversation.channel] += 1;
      byStatus[conversation.status] += 1;

      const firstVisitor = conversation.messages.find((message: AnalyticsMessageItem) => message.senderType === "VISITOR");
      const firstAgent = conversation.messages.find((message: AnalyticsMessageItem) => message.senderType === "AGENT");

      if (firstVisitor) {
        const hour = firstVisitor.createdAt.getHours();
        busiestHourMap.set(hour, (busiestHourMap.get(hour) ?? 0) + 1);
      }

      if (conversation.currentAssigneeId && conversation.status !== "RESOLVED") {
        agentLoadMap.set(
          conversation.currentAssigneeId,
          (agentLoadMap.get(conversation.currentAssigneeId) ?? 0) + 1,
        );
      }

      if (firstVisitor && firstAgent) {
        const diffMinutes =
          (firstAgent.createdAt.getTime() - firstVisitor.createdAt.getTime()) / (1000 * 60);
        if (diffMinutes >= 0) {
          firstResponseMinutes.push(diffMinutes);
          if (diffMinutes > FIRST_RESPONSE_TARGET_MINUTES) {
            firstResponseBreaches += 1;
          }
        }
      }

      const resolutionAgeHours =
        conversation.status === "RESOLVED"
          ? (conversation.updatedAt.getTime() - conversation.createdAt.getTime()) / (1000 * 60 * 60)
          : (Date.now() - conversation.createdAt.getTime()) / (1000 * 60 * 60);

      if (conversation.status === "RESOLVED" && resolutionAgeHours >= 0) {
        resolutionHours.push(resolutionAgeHours);
      }

      if (resolutionAgeHours > RESOLUTION_TARGET_HOURS) {
        resolutionBreaches += 1;
      }
    }

    return NextResponse.json({
      totals: {
        conversations: conversations.length,
        resolved: byStatus.RESOLVED,
        open: byStatus.OPEN,
        snoozed: byStatus.SNOOZED,
        resolutionRate: conversations.length > 0 ? byStatus.RESOLVED / conversations.length : 0,
      },
      byChannel,
      firstResponse: {
        targetMinutes: FIRST_RESPONSE_TARGET_MINUTES,
        medianMinutes: median(firstResponseMinutes),
        breaches: firstResponseBreaches,
        measuredConversations: firstResponseMinutes.length,
      },
      resolution: {
        targetHours: RESOLUTION_TARGET_HOURS,
        medianHours: median(resolutionHours),
        breaches: resolutionBreaches,
        measuredConversations: resolutionHours.length,
      },
      busiestHours: [...busiestHourMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([hour, count]) => ({ hour, count })),
      agentPerformance: [...agentLoadMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([agentId, assignedCount]) => ({ agentId, assignedCount })),
    });
  } catch (error) {
    chatLog("error", "inbox_analytics_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
