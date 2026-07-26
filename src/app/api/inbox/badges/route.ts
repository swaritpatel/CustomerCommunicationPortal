import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { withApiLogging } from "@/modules/observability/api";

async function GETHandler() {
  try {
    const claims = await getSessionClaims();
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [unresolvedCount, unreadCount, chatUnreadCount, pendingInviteCount] = await Promise.all([
      db.conversation.count({
        where: {
          workspaceId: claims.workspaceId,
          status: { in: ["OPEN", "SNOOZED"] },
          messages: { some: {} },
        },
      }),
      db.chatMessage.count({
        where: {
          workspaceId: claims.workspaceId,
          senderType: "VISITOR",
          readByAgentAt: null,
        },
      }),
      db.chatMessage.count({
        where: {
          workspaceId: claims.workspaceId,
          senderType: "VISITOR",
          readByAgentAt: null,
          conversation: { channel: "CHAT_WIDGET" },
        },
      }),
      db.invite.count({
        where: {
          workspaceId: claims.workspaceId,
          status: "PENDING",
        },
      }),
    ]);

    return NextResponse.json({
      unreadCount,
      unresolvedCount,
      chatUnreadCount,
      pendingInviteCount,
    });
  } catch (error) {
    chatLog("error", "inbox_badges_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const GET = withApiLogging(GETHandler, "GET src/app/api/inbox/badges");
