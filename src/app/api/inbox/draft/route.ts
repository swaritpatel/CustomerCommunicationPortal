import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { buildAutoReplyDraft } from "@/modules/email/ai-draft";
import { buildKnowledgeSearchOr, scoreKnowledgeArticle, tokenizeKnowledgeQuery } from "@/modules/kb/search";
import { withApiLogging } from "@/modules/observability/api";
import { findRelevantSupportPolicies } from "@/modules/policies/support-policies";

type DraftMessageItem = {
  senderType: "VISITOR" | "AGENT" | "SYSTEM";
  body: string;
};

function cleanSearchText(value: string) {
  return value
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

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
    const articleQuery = cleanSearchText(`${conversation.subject} ${latestCustomerMessage?.body ?? ""}`);
    const articleTokens = tokenizeKnowledgeQuery(articleQuery);
    const suggestedArticles =
      articleTokens.length > 0
        ? await db.knowledgeBaseArticle.findMany({
            where: {
              workspaceId: conversation.workspaceId,
              status: "PUBLISHED",
              OR: buildKnowledgeSearchOr(articleTokens),
            },
            orderBy: { updatedAt: "desc" },
            take: 12,
            select: {
              title: true,
              slug: true,
              excerpt: true,
              contentHtml: true,
            },
          })
        : [];

    const draft = buildAutoReplyDraft({
      subject: conversation.subject,
      customerName: conversation.customerName,
      recentMessages: messages,
      cannedResponses: Array.isArray(body?.cannedResponses) ? body.cannedResponses : [],
      supportPolicies,
      suggestedArticles: suggestedArticles
        .map((article) => ({
          ...article,
          score: scoreKnowledgeArticle(article, articleTokens),
        }))
        .filter((article) => article.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((article) => ({
          title: article.title,
          excerpt: article.excerpt,
          href: `/help/${conversation.workspace.slug}?article=${article.slug}`,
        })),
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
