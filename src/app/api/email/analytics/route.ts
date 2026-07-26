import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { withApiLogging } from "@/modules/observability/api";

const FIRST_RESPONSE_TARGET_MINUTES = 15;
const RESOLUTION_TARGET_HOURS = 24;

type AnalyticsMessageItem = {
  senderType: string;
  createdAt: Date;
};

type EmailAnalyticsConversation = {
  id: string;
  status: string;
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

async function GETHandler() {
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

    const conversations: EmailAnalyticsConversation[] = await db.conversation.findMany({
      where: {
        workspaceId: claims.workspaceId,
        channel: "EMAIL",
      },
      select: {
        id: true,
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

    let firstResponseBreaches = 0;
    let resolutionBreaches = 0;
    let resolvedCount = 0;

    for (const conversation of conversations) {
      const firstVisitor = conversation.messages.find((message: AnalyticsMessageItem) => message.senderType === "VISITOR");
      const firstAgent = conversation.messages.find((message: AnalyticsMessageItem) =>
        message.senderType === "AGENT" || message.senderType === "SYSTEM"
      );

      if (firstVisitor) {
        const hour = firstVisitor.createdAt.getHours();
        busiestHourMap.set(hour, (busiestHourMap.get(hour) ?? 0) + 1);
      }

      if (conversation.currentAssigneeId) {
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

      if (conversation.status === "RESOLVED") {
        resolvedCount += 1;
        const diffHours =
          (conversation.updatedAt.getTime() - conversation.createdAt.getTime()) / (1000 * 60 * 60);
        if (diffHours >= 0) {
          resolutionHours.push(diffHours);
          if (diffHours > RESOLUTION_TARGET_HOURS) {
            resolutionBreaches += 1;
          }
        }
      }
    }

    const busiestHours = [...busiestHourMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour, count]) => ({ hour, count }));

    const agentPerformance = [...agentLoadMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([agentId, assignedCount]) => ({ agentId, assignedCount }));

    return NextResponse.json({
      totals: {
        conversations: conversations.length,
        resolved: resolvedCount,
        resolutionRate: conversations.length > 0 ? resolvedCount / conversations.length : 0,
      },
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
      busiestHours,
      agentPerformance,
    });
  } catch (error) {
    chatLog("error", "email_analytics_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const GET = withApiLogging(GETHandler, "GET src/app/api/email/analytics");
