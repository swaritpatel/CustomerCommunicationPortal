"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Category = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
};

type Article = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  contentHtml: string;
  updatedAt: string;
  category: { id: string; title: string; slug: string } | null;
};

export function HelpCenterClient({ workspaceSlug }: { workspaceSlug: string }) {
  const searchParams = useSearchParams();
  const requestedArticle = searchParams.get("article") ?? "";
  const [workspaceName, setWorkspaceName] = useState("Help Center");
  const [categories, setCategories] = useState<Category[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [query, setQuery] = useState("");
  const [activeSlug, setActiveSlug] = useState(requestedArticle);
  const [isLoading, setIsLoading] = useState(true);

  const selectedSlug = requestedArticle || activeSlug;
  const activeArticle = useMemo(
    () => articles.find((article) => article.slug === selectedSlug) ?? articles[0] ?? null,
    [articles, selectedSlug],
  );

  const loadArticles = useCallback(async () => {
    setIsLoading(true);
    const params = new URLSearchParams({ workspace: workspaceSlug });
    if (query.trim()) {
      params.set("q", query.trim());
    }

    const response = await fetch(`/api/kb/search?${params.toString()}`, {
      cache: "no-store",
    }).catch(() => null);

    if (response?.ok) {
      const payload = await response.json();
      setWorkspaceName(payload.workspace?.name ?? "Help Center");
      setCategories((payload.categories ?? []) as Category[]);
      setArticles((payload.articles ?? []) as Article[]);
    }
    setIsLoading(false);
  }, [workspaceSlug, query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadArticles();
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [loadArticles]);

  return (
    <main className="min-h-screen bg-[var(--color-canvas)] px-5 py-8 text-[var(--color-ink)] sm:px-8">
      <div className="mx-auto grid max-w-6xl gap-8">
        <header className="py-10 text-center">
          <p className="eyebrow">CCP Help</p>
          <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.04em] sm:text-5xl">
            {workspaceName} knowledge base
          </h1>
          <div className="mx-auto mt-6 max-w-2xl">
            <input
              className="input text-base"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search help articles"
            />
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <aside className="grid content-start gap-4">
            {categories.map((category) => {
              const categoryArticles = articles.filter((article) => article.category?.id === category.id);
              if (categoryArticles.length === 0) {
                return null;
              }
              return (
                <div key={category.id} className="card rounded-[1.25rem] p-4">
                  <strong className="block">{category.title}</strong>
                  {category.description ? (
                    <p className="mt-1 text-sm text-[var(--color-muted)]">{category.description}</p>
                  ) : null}
                  <div className="mt-3 grid gap-2">
                    {categoryArticles.map((article) => (
                      <button
                        key={article.id}
                        className={`rounded-2xl border px-3 py-2 text-left text-sm transition ${
                          activeArticle?.id === article.id
                            ? "border-[rgba(182,90,52,0.45)] bg-[var(--color-accent-soft)]"
                            : "border-[var(--color-line)] bg-[rgba(255,253,248,0.72)]"
                        }`}
                        onClick={() => setActiveSlug(article.slug)}
                      >
                        {article.title}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            {articles.some((article) => !article.category) ? (
              <div className="card rounded-[1.25rem] p-4">
                <strong className="block">General</strong>
                <div className="mt-3 grid gap-2">
                  {articles
                    .filter((article) => !article.category)
                    .map((article) => (
                      <button
                        key={article.id}
                        className={`rounded-2xl border px-3 py-2 text-left text-sm transition ${
                          activeArticle?.id === article.id
                            ? "border-[rgba(182,90,52,0.45)] bg-[var(--color-accent-soft)]"
                            : "border-[var(--color-line)] bg-[rgba(255,253,248,0.72)]"
                        }`}
                        onClick={() => setActiveSlug(article.slug)}
                      >
                        {article.title}
                      </button>
                    ))}
                </div>
              </div>
            ) : null}
          </aside>

          <article className="card rounded-[1.5rem] p-6 sm:p-8">
            {isLoading ? (
              <p className="text-[var(--color-muted)]">Loading help articles...</p>
            ) : activeArticle ? (
              <>
                <p className="eyebrow">{activeArticle.category?.title ?? "General"}</p>
                <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.03em]">{activeArticle.title}</h2>
                {activeArticle.excerpt ? (
                  <p className="mt-3 text-[var(--color-muted)]">{activeArticle.excerpt}</p>
                ) : null}
                <div
                  className="help-article mt-8 text-base leading-7"
                  dangerouslySetInnerHTML={{ __html: activeArticle.contentHtml }}
                />
              </>
            ) : (
              <div className="py-14 text-center">
                <h2 className="text-2xl font-bold">No published articles yet</h2>
                <p className="mt-2 text-[var(--color-muted)]">
                  Published answers will appear here for customers to search.
                </p>
              </div>
            )}
          </article>
        </section>
      </div>

      <style jsx>{`
        .help-article :global(h2) {
          margin: 1.3rem 0 0.5rem;
          font-size: 1.45rem;
          font-weight: 800;
        }
        .help-article :global(h3) {
          margin: 1rem 0 0.35rem;
          font-size: 1.15rem;
          font-weight: 800;
        }
        .help-article :global(p) {
          margin: 0 0 0.9rem;
        }
        .help-article :global(ul),
        .help-article :global(ol) {
          margin: 0.75rem 0 0.9rem 1.2rem;
        }
        .help-article :global(a) {
          color: var(--color-accent-strong);
          font-weight: 700;
          text-decoration: underline;
        }
        .help-article :global(blockquote) {
          margin: 1rem 0;
          border-left: 3px solid var(--color-accent);
          padding-left: 1rem;
          color: var(--color-muted);
        }
      `}</style>
    </main>
  );
}
