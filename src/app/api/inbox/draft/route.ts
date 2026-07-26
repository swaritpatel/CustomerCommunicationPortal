import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { buildAutoReplyDraft } from "@/modules/email/ai-draft";
import { findSuggestedKnowledgeArticles } from "@/modules/kb/suggestions";
import { withApiLogging } from "@/modules/observability/api";
import { findRelevantSupportPolicies } from "@/modules/policies/support-policies";

type DraftMessageItem = {
  senderType: "VISITOR" | "AGENT" | "SYSTEM";
  body: string;
};

async function POSTHandler(request: Request) {
  try {
    const claims = await getSessionClaims();
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { conversationId?: string; cannedResponses?: string[] }
      | null;

    const conversationId = body?.conversationId;
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        workspaceId: true,
        subject: true,
        customerName: true,
        workspace: {
          select: {
            slug: true,
          },
        },
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

    const messages: DraftMessageItem[] = await db.chatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      take: 24,
      select: {
        senderType: true,
        body: true,
      },
    });
    const latestCustomerMessage = [...messages].reverse().find((message) => message.senderType === "VISITOR");
    const supportPolicies = await findRelevantSupportPolicies({
      workspaceId: conversation.workspaceId,
      text: `${conversation.subject}\n${latestCustomerMessage?.body ?? ""}`,
    });
    const suggestedArticles = await findSuggestedKnowledgeArticles({
      workspaceId: conversation.workspaceId,
      workspaceSlug: conversation.workspace.slug,
      text: `${conversation.subject}\n${latestCustomerMessage?.body ?? ""}`,
      take: 3,
    });

    const draft = buildAutoReplyDraft({
      subject: conversation.subject,
      customerName: conversation.customerName,
      recentMessages: messages,
      cannedResponses: Array.isArray(body?.cannedResponses) ? body.cannedResponses : [],
      supportPolicies,
      suggestedArticles,
    });

    return NextResponse.json({ draft });
  } catch (error) {
    chatLog("error", "inbox_draft_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiLogging(POSTHandler, "POST src/app/api/inbox/draft");
