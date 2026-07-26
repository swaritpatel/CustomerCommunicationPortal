export type KnowledgeSearchArticle = {
  title: string;
  excerpt: string | null;
  contentHtml?: string | null;
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "bank",
  "but",
  "can",
  "for",
  "from",
  "have",
  "hello",
  "help",
  "how",
  "issue",
  "mail",
  "need",
  "not",
  "please",
  "regarding",
  "request",
  "support",
  "team",
  "the",
  "this",
  "with",
  "you",
  "your",
]);

export function tokenizeKnowledgeQuery(value: string, limit = 8) {
  const seen = new Set<string>();

  return value
    .toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    .filter((token) => {
      if (seen.has(token)) {
        return false;
      }
      seen.add(token);
      return true;
    })
    .slice(0, limit);
}

export function buildKnowledgeSearchOr(tokens: string[]) {
  return tokens.flatMap((token) => [
    { title: { contains: token, mode: "insensitive" as const } },
    { excerpt: { contains: token, mode: "insensitive" as const } },
    { contentHtml: { contains: token, mode: "insensitive" as const } },
  ]);
}

export function scoreKnowledgeArticle(article: KnowledgeSearchArticle, tokens: string[]) {
  const title = article.title.toLowerCase();
  const excerpt = (article.excerpt ?? "").toLowerCase();
  const content = (article.contentHtml ?? "").toLowerCase().replace(/<[^>]*>/g, " ");

  return tokens.reduce((score, token) => {
    let nextScore = score;
    if (title.includes(token)) {
      nextScore += 6;
    }
    if (excerpt.includes(token)) {
      nextScore += 3;
    }
    if (content.includes(token)) {
      nextScore += 1;
    }
    return nextScore;
  }, 0);
}
