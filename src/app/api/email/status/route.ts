import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";

const allowedStatuses = ["OPEN", "SNOOZED", "RESOLVED"] as const;
type EmailStatus = (typeof allowedStatuses)[number];

function isEmailStatus(value: string | undefined): value is EmailStatus {
  return allowedStatuses.some((status) => status === value);
}

export async function POST(request: Request) {
  try {
    const claims = await getSessionClaims();
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { conversationId?: string; status?: string }
      | null;

    const conversationId = body?.conversationId;
    const status = body?.status;

    if (!conversationId || !isEmailStatus(status)) {
      return NextResponse.json(
        { error: "conversationId and a valid status are required" },
        { status: 400 },
      );
    }

    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        workspaceId: true,
        channel: true,
        status: true,
      },
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

    if (conversation.status === status) {
      return NextResponse.json({ ok: true, status });
    }

    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        status,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, status });
  } catch (error) {
    chatLog("error", "email_status_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
