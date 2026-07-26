import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { createKnowledgeArticleFromConversation } from "@/modules/kb/from-conversation";
import { withApiLogging } from "@/modules/observability/api";

async function POSTHandler(request: Request) {
  try {
    const claims = await getSessionClaims();
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as { conversationId?: string } | null;
    const conversationId = body?.conversationId?.trim();
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
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

    const result = await createKnowledgeArticleFromConversation({
      workspaceId: claims.workspaceId,
      conversationId,
      authorUserId: claims.sub,
      status: "PUBLISHED",
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true, article: result.article, reused: "reused" in result ? result.reused : false });
  } catch (error) {
    chatLog("error", "kb_from_conversation_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiLogging(POSTHandler, "POST src/app/api/kb/from-conversation");
