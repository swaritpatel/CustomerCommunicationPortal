import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { chatLog } from "@/modules/chat/log";

function containsQuery(query: string) {
  return [
    { title: { contains: query, mode: "insensitive" as const } },
    { excerpt: { contains: query, mode: "insensitive" as const } },
    { contentHtml: { contains: query, mode: "insensitive" as const } },
  ];
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const workspaceSlug = params.get("workspace")?.trim();
    const query = params.get("q")?.trim() || "";

    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspace is required" }, { status: 400 });
    }

    const workspace = await db.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { id: true, name: true, slug: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const [categories, articles] = await Promise.all([
      db.knowledgeBaseCategory.findMany({
        where: {
          workspaceId: workspace.id,
          articles: { some: { status: "PUBLISHED" } },
        },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
        },
      }),
      db.knowledgeBaseArticle.findMany({
        where: {
          workspaceId: workspace.id,
          status: "PUBLISHED",
          ...(query ? { OR: containsQuery(query) } : {}),
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 60,
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          contentHtml: true,
          updatedAt: true,
          category: {
            select: { id: true, title: true, slug: true },
          },
        },
      }),
    ]);

    return NextResponse.json({
      workspace,
      categories,
      articles,
    });
  } catch (error) {
    chatLog("error", "kb_search_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
