import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { withApiLogging } from "@/modules/observability/api";

async function POSTHandler(request: Request) {
  try {
    const claims = await getSessionClaims();
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { conversationId?: string; body?: string }
      | null;
    const conversationId = body?.conversationId;
    const commentBody = body?.body?.trim();

    if (!conversationId || !commentBody) {
      return NextResponse.json({ error: "conversationId and body are required" }, { status: 400 });
    }

    if (commentBody.length > 2000) {
      return NextResponse.json({ error: "Comment must be under 2000 characters" }, { status: 400 });
    }

    const [conversation, membership] = await Promise.all([
      db.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, workspaceId: true, ticketNumber: true },
      }),
      db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: claims.workspaceId,
            userId: claims.sub,
          },
        },
        select: { id: true, status: true },
      }),
    ]);

    if (!conversation || conversation.workspaceId !== claims.workspaceId) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    if (!membership || membership.status !== "ACTIVE") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const comment = await db.conversationComment.create({
      data: {
        workspaceId: claims.workspaceId,
        conversationId: conversation.id,
        authorUserId: claims.sub,
        body: commentBody,
      },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
    });

    chatLog("info", "inbox_comment_created", {
      workspaceId: claims.workspaceId,
      conversationId: conversation.id,
      ticketNumber: conversation.ticketNumber,
      commentId: comment.id,
    });

    return NextResponse.json({ ok: true, comment });
  } catch (error) {
    chatLog("error", "inbox_comment_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiLogging(POSTHandler, "POST src/app/api/inbox/comments");
