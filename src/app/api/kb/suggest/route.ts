import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { chatLog } from "@/modules/chat/log";

type SuggestedArticleItem = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
};

export async function GET(request: Request) {
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

    const articles: SuggestedArticleItem[] = await db.knowledgeBaseArticle.findMany({
      where: {
        workspaceId: workspace.id,
        status: "PUBLISHED",
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { excerpt: { contains: query, mode: "insensitive" } },
          { contentHtml: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
      },
    });

    return NextResponse.json({
      suggestions: articles.map((article: SuggestedArticleItem) => ({
        ...article,
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
