import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { chatLog } from "@/modules/chat/log";
import { buildKnowledgeSearchOr, scoreKnowledgeArticle, tokenizeKnowledgeQuery } from "@/modules/kb/search";
import { withApiLogging } from "@/modules/observability/api";

type SuggestedArticleItem = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  contentHtml: string;
};

async function GETHandler(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const workspaceSlug = params.get("workspace")?.trim();
    const query = params.get("q")?.trim();

    if (!workspaceSlug || !query || query.length < 3) {
      return NextResponse.json({ suggestions: [] });
    }

    const workspace = await db.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { id: true, slug: true },
    });

    if (!workspace) {
      return NextResponse.json({ suggestions: [] });
    }

    const tokens = tokenizeKnowledgeQuery(query);
    if (tokens.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    const articles: SuggestedArticleItem[] = await db.knowledgeBaseArticle.findMany({
      where: {
        workspaceId: workspace.id,
        status: "PUBLISHED",
        OR: buildKnowledgeSearchOr(tokens),
      },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
        contentHtml: true,
      },
    });

    return NextResponse.json({
      suggestions: articles
        .map((article: SuggestedArticleItem) => ({
          ...article,
          score: scoreKnowledgeArticle(article, tokens),
        }))
        .filter((article) => article.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((article) => ({
          id: article.id,
          title: article.title,
          slug: article.slug,
          excerpt: article.excerpt,
          href: `/help/${workspace.slug}?article=${article.slug}`,
        })),
    });
  } catch (error) {
    chatLog("error", "kb_suggest_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ suggestions: [] });
  }
}

export const GET = withApiLogging(GETHandler, "GET src/app/api/kb/suggest");
