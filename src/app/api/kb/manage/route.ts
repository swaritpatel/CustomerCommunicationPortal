import { NextResponse } from "next/server";
import type { KnowledgeBaseArticleStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { toWorkspaceSlug } from "@/modules/workspaces/slug";

const allowedArticleStatuses = ["DRAFT", "PUBLISHED"] as const;

function stripTags(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeRichText(html: string) {
  const escaped = html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\s(href|src)="javascript:[^"]*"/gi, "");

  const allowed = new Set([
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "h2",
    "h3",
    "a",
  ]);

  return escaped.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (match, tagName: string, rawAttrs: string) => {
    const tag = tagName.toLowerCase();
    if (!allowed.has(tag)) {
      return "";
    }

    if (tag !== "a") {
      return match.startsWith("</") ? `</${tag}>` : `<${tag}>`;
    }

    if (match.startsWith("</")) {
      return "</a>";
    }

    const hrefMatch = rawAttrs.match(/\shref=["']([^"']+)["']/i);
    const href = hrefMatch?.[1]?.trim();
    if (!href || (!href.startsWith("http://") && !href.startsWith("https://") && !href.startsWith("mailto:"))) {
      return "<a>";
    }

    return `<a href="${href}" target="_blank" rel="noreferrer">`;
  });
}

async function generateUniqueSlug(input: {
  workspaceId: string;
  title: string;
  type: "category" | "article";
  existingId?: string;
}) {
  const base = toWorkspaceSlug(input.title) || `${input.type}-${crypto.randomUUID().slice(0, 8)}`;

  for (let index = 0; index < 12; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    const existing =
      input.type === "category"
        ? await db.knowledgeBaseCategory.findUnique({
            where: { workspaceId_slug: { workspaceId: input.workspaceId, slug: candidate } },
            select: { id: true },
          })
        : await db.knowledgeBaseArticle.findUnique({
            where: { workspaceId_slug: { workspaceId: input.workspaceId, slug: candidate } },
            select: { id: true },
          });

    if (!existing || existing.id === input.existingId) {
      return candidate;
    }
  }

  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

async function requireKbMember() {
  const claims = await getSessionClaims();
  if (!claims) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
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
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { claims };
}

export async function GET() {
  try {
    const auth = await requireKbMember();
    if (auth.error) {
      return auth.error;
    }

    const [categories, articles] = await Promise.all([
      db.knowledgeBaseCategory.findMany({
        where: { workspaceId: auth.claims.workspaceId },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          sortOrder: true,
          _count: {
            select: { articles: true },
          },
        },
      }),
      db.knowledgeBaseArticle.findMany({
        where: { workspaceId: auth.claims.workspaceId },
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          contentHtml: true,
          status: true,
          categoryId: true,
          publishedAt: true,
          updatedAt: true,
          category: {
            select: { title: true },
          },
        },
      }),
    ]);

    return NextResponse.json({
      categories,
      articles,
    });
  } catch (error) {
    chatLog("error", "kb_manage_get_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireKbMember();
    if (auth.error) {
      return auth.error;
    }

    const body = (await request.json().catch(() => null)) as
      | {
          action?: string;
          id?: string;
          title?: string;
          description?: string;
          categoryId?: string | null;
          excerpt?: string;
          contentHtml?: string;
          status?: KnowledgeBaseArticleStatus;
        }
      | null;

    if (!body?.action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    if (body.action === "saveCategory") {
      const title = body.title?.trim();
      if (!title || title.length < 2) {
        return NextResponse.json({ error: "Category title is required" }, { status: 400 });
      }

      const slug = await generateUniqueSlug({
        workspaceId: auth.claims.workspaceId,
        title,
        type: "category",
        existingId: body.id,
      });

      const category = body.id
        ? await db.knowledgeBaseCategory.update({
            where: { id: body.id, workspaceId: auth.claims.workspaceId },
            data: {
              title,
              slug,
              description: body.description?.trim() || null,
            },
          })
        : await db.knowledgeBaseCategory.create({
            data: {
              workspaceId: auth.claims.workspaceId,
              title,
              slug,
              description: body.description?.trim() || null,
            },
          });

      return NextResponse.json({ ok: true, category });
    }

    if (body.action === "saveArticle") {
      const title = body.title?.trim();
      if (!title || title.length < 3) {
        return NextResponse.json({ error: "Article title is required" }, { status: 400 });
      }

      const status = allowedArticleStatuses.some((item) => item === body.status)
        ? body.status
        : "DRAFT";
      const contentHtml = sanitizeRichText(body.contentHtml?.trim() || "<p></p>");
      const excerpt = body.excerpt?.trim() || stripTags(contentHtml).slice(0, 180) || null;

      let categoryId = body.categoryId?.trim() || null;
      if (categoryId) {
        const category = await db.knowledgeBaseCategory.findUnique({
          where: { id: categoryId },
          select: { workspaceId: true },
        });
        if (!category || category.workspaceId !== auth.claims.workspaceId) {
          categoryId = null;
        }
      }

      const slug = await generateUniqueSlug({
        workspaceId: auth.claims.workspaceId,
        title,
        type: "article",
        existingId: body.id,
      });

      const article = body.id
        ? await db.knowledgeBaseArticle.update({
            where: { id: body.id, workspaceId: auth.claims.workspaceId },
            data: {
              title,
              slug,
              excerpt,
              contentHtml,
              categoryId,
              status,
              publishedAt: status === "PUBLISHED" ? new Date() : null,
            },
          })
        : await db.knowledgeBaseArticle.create({
            data: {
              workspaceId: auth.claims.workspaceId,
              authorUserId: auth.claims.sub,
              title,
              slug,
              excerpt,
              contentHtml,
              categoryId,
              status,
              publishedAt: status === "PUBLISHED" ? new Date() : null,
            },
          });

      return NextResponse.json({ ok: true, article });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    chatLog("error", "kb_manage_post_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
