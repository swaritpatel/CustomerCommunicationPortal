import { db } from "@/lib/db";
import { buildKnowledgeSearchOr, scoreKnowledgeArticle, tokenizeKnowledgeQuery } from "@/modules/kb/search";

export type SuggestedKnowledgeArticle = {
  title: string;
  excerpt: string | null;
  href: string;
};

function cleanSearchText(value: string) {
  return value
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

export async function findSuggestedKnowledgeArticles(input: {
  workspaceId: string;
  workspaceSlug: string;
  text: string;
  take?: number;
}): Promise<SuggestedKnowledgeArticle[]> {
  const query = cleanSearchText(input.text);
  const tokens = tokenizeKnowledgeQuery(query);
  if (tokens.length === 0) {
    return [];
  }

  const articles = await db.knowledgeBaseArticle.findMany({
    where: {
      workspaceId: input.workspaceId,
      status: "PUBLISHED",
      OR: buildKnowledgeSearchOr(tokens),
    },
    orderBy: { updatedAt: "desc" },
    take: 12,
    select: {
      title: true,
      slug: true,
      excerpt: true,
      contentHtml: true,
    },
  });

  return articles
    .map((article) => ({
      ...article,
      score: scoreKnowledgeArticle(article, tokens),
    }))
    .filter((article) => article.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.take ?? 3)
    .map((article) => ({
      title: article.title,
      excerpt: article.excerpt,
      href: `/help/${input.workspaceSlug}?article=${article.slug}`,
    }));
}
