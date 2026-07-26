"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ArticleStatus = "DRAFT" | "PUBLISHED";

type Category = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  _count?: { articles: number };
};

type Article = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  contentHtml: string;
  status: ArticleStatus;
  categoryId: string | null;
  publishedAt: string | null;
  updatedAt: string;
  category: { title: string } | null;
};

type DraftArticle = {
  id?: string;
  title: string;
  excerpt: string;
  categoryId: string;
  contentHtml: string;
  status: ArticleStatus;
};

type CustomDomain = {
  id: string;
  hostname: string;
  status: "PENDING" | "VERIFIED" | "FAILED";
  sslStatus: "PENDING" | "PROVISIONING" | "ACTIVE" | "FAILED";
  verificationToken: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  failureReason: string | null;
};

const EMPTY_ARTICLE: DraftArticle = {
  title: "",
  excerpt: "",
  categoryId: "",
  contentHtml: "<p>Write the answer customers should see.</p>",
  status: "DRAFT",
};

function formatDate(value: string | null) {
  if (!value) {
    return "Not published";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function KbAdminClient({
  workspaceName,
  workspaceSlug,
}: {
  workspaceName: string;
  workspaceSlug: string;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [activeArticle, setActiveArticle] = useState<DraftArticle>(EMPTY_ARTICLE);
  const [categoryTitle, setCategoryTitle] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | ArticleStatus>("ALL");
  const [domains, setDomains] = useState<CustomDomain[]>([]);
  const [domainInput, setDomainInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDomainSaving, setIsDomainSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [domainMessage, setDomainMessage] = useState("");

  const publishedCount = useMemo(
    () => articles.filter((article) => article.status === "PUBLISHED").length,
    [articles],
  );

  const filteredArticles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return articles.filter((article) => {
      const matchesStatus = status === "ALL" || article.status === status;
      const matchesQuery =
        !needle ||
        article.title.toLowerCase().includes(needle) ||
        article.excerpt?.toLowerCase().includes(needle) ||
        article.category?.title.toLowerCase().includes(needle);
      return matchesStatus && matchesQuery;
    });
  }, [articles, query, status]);

  const loadKb = useCallback(async () => {
    const response = await fetch("/api/kb/manage", { cache: "no-store" }).catch(() => null);
    if (!response || !response.ok) {
      setMessage("Could not load the knowledge base.");
      return;
    }

    const payload = await response.json();
    setCategories((payload.categories ?? []) as Category[]);
    setArticles((payload.articles ?? []) as Article[]);
  }, []);

  const loadDomains = useCallback(async () => {
    const response = await fetch("/api/kb/domain", { cache: "no-store" }).catch(() => null);
    if (!response || !response.ok) {
      return;
    }

    const payload = await response.json();
    setDomains((payload.domains ?? []) as CustomDomain[]);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadKb();
      void loadDomains();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadKb, loadDomains]);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== activeArticle.contentHtml) {
      editorRef.current.innerHTML = activeArticle.contentHtml;
    }
  }, [activeArticle.id, activeArticle.contentHtml]);

  const selectArticle = (article: Article) => {
    setActiveArticle({
      id: article.id,
      title: article.title,
      excerpt: article.excerpt ?? "",
      categoryId: article.categoryId ?? "",
      contentHtml: article.contentHtml,
      status: article.status,
    });
    setMessage("");
  };

  const saveCategory = async () => {
    const title = categoryTitle.trim();
    if (!title) {
      setMessage("Add a category title first.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/kb/manage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "saveCategory",
          title,
          description: categoryDescription,
        }),
      });
      if (!response.ok) {
        throw new Error("Category save failed");
      }
      setCategoryTitle("");
      setCategoryDescription("");
      setMessage("Category saved.");
      await loadKb();
    } catch {
      setMessage("Could not save the category.");
    } finally {
      setIsSaving(false);
    }
  };

  const saveArticle = async (nextStatus: ArticleStatus) => {
    if (!activeArticle.title.trim()) {
      setMessage("Add an article title first.");
      return;
    }

    setIsSaving(true);
    try {
      const contentHtml = editorRef.current?.innerHTML || activeArticle.contentHtml;
      const response = await fetch("/api/kb/manage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "saveArticle",
          ...activeArticle,
          status: nextStatus,
          categoryId: activeArticle.categoryId || null,
          contentHtml,
        }),
      });
      if (!response.ok) {
        throw new Error("Article save failed");
      }
      const payload = await response.json();
      setActiveArticle((previous) => ({
        ...previous,
        id: payload.article.id,
        status: payload.article.status,
        contentHtml: payload.article.contentHtml,
      }));
      setMessage(nextStatus === "PUBLISHED" ? "Article published." : "Draft saved.");
      await loadKb();
    } catch {
      setMessage("Could not save the article.");
    } finally {
      setIsSaving(false);
    }
  };

  const command = (name: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(name, false, value);
    setActiveArticle((previous) => ({
      ...previous,
      contentHtml: editorRef.current?.innerHTML || previous.contentHtml,
    }));
  };

  const connectDomain = async () => {
    const hostname = domainInput.trim();
    if (!hostname) {
      setDomainMessage("Add a hostname first.");
      return;
    }

    setIsDomainSaving(true);
    try {
      const response = await fetch("/api/kb/domain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "connectDomain", hostname }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not connect domain");
      }
      setDomainInput("");
      setDomainMessage("Domain added. Create the DNS records below, then verify.");
      await loadDomains();
    } catch (error) {
      setDomainMessage(error instanceof Error ? error.message : "Could not connect domain.");
    } finally {
      setIsDomainSaving(false);
    }
  };

  const verifyDomain = async (domain: CustomDomain) => {
    setIsDomainSaving(true);
    try {
      const response = await fetch("/api/kb/domain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "verifyDomain",
          domainId: domain.id,
          dnsTxtValue: domain.verificationToken,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Verification failed");
      }
      setDomainMessage("Domain verified. SSL is marked active in this local stub.");
      await loadDomains();
    } catch (error) {
      setDomainMessage(error instanceof Error ? error.message : "Could not verify domain.");
      await loadDomains();
    } finally {
      setIsDomainSaving(false);
    }
  };

  return (
    <main className="grid gap-6">
      <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">Knowledge Base</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.03em]">
            Help articles for {workspaceName}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">
            Create customer-facing answers, publish them to the help center, and let chat suggest the right article while visitors type.
          </p>
        </div>
        <a className="btn-secondary" href={`/help/${workspaceSlug}`} target="_blank" rel="noreferrer">
          Open public help center
        </a>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card rounded-[1.25rem] p-5">
          <p className="eyebrow">Published</p>
          <strong className="mt-2 block text-3xl">{publishedCount}</strong>
        </div>
        <div className="card rounded-[1.25rem] p-5">
          <p className="eyebrow">Drafts</p>
          <strong className="mt-2 block text-3xl">{articles.length - publishedCount}</strong>
        </div>
        <div className="card rounded-[1.25rem] p-5">
          <p className="eyebrow">Categories</p>
          <strong className="mt-2 block text-3xl">{categories.length}</strong>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <aside className="grid gap-5 content-start">
          <div className="card rounded-[1.5rem] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Library</p>
                <h3 className="mt-1 text-xl font-bold">Articles</h3>
              </div>
              <button
                className="btn-primary px-4 py-2 text-sm"
                onClick={() => {
                  setActiveArticle(EMPTY_ARTICLE);
                  setMessage("");
                }}
              >
                New
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <input
                className="input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search articles"
              />
              <select className="input" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                <option value="ALL">All statuses</option>
                <option value="PUBLISHED">Published</option>
                <option value="DRAFT">Drafts</option>
              </select>
            </div>
            <div className="mt-4 grid max-h-[540px] gap-2 overflow-auto pr-1">
              {filteredArticles.map((article) => (
                <button
                  key={article.id}
                  className={`rounded-2xl border p-4 text-left transition ${
                    article.id === activeArticle.id
                      ? "border-[rgba(230,47,137,0.45)] bg-[var(--color-accent-soft)]"
                      : "border-[var(--color-line)] bg-[rgba(255,253,248,0.72)] hover:border-[var(--color-line-strong)]"
                  }`}
                  onClick={() => selectArticle(article)}
                >
                  <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-soft)]">
                    {article.status.toLowerCase()} · {article.category?.title ?? "Uncategorized"}
                  </span>
                  <strong className="mt-1 block">{article.title}</strong>
                  <span className="mt-1 block text-xs text-[var(--color-muted)]">{formatDate(article.publishedAt)}</span>
                </button>
              ))}
              {filteredArticles.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-muted)]">
                  No articles match this view.
                </p>
              ) : null}
            </div>
          </div>

          <div className="card rounded-[1.5rem] p-5">
            <p className="eyebrow">Sections</p>
            <h3 className="mt-1 text-xl font-bold">Categories</h3>
            <div className="mt-4 grid gap-3">
              <input
                className="input"
                value={categoryTitle}
                onChange={(event) => setCategoryTitle(event.target.value)}
                placeholder="Category title"
              />
              <textarea
                className="input min-h-24 resize-none"
                value={categoryDescription}
                onChange={(event) => setCategoryDescription(event.target.value)}
                placeholder="Short description"
              />
              <button className="btn-secondary" disabled={isSaving} onClick={() => void saveCategory()}>
                Add category
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              {categories.map((category) => (
                <div key={category.id} className="rounded-2xl border border-[var(--color-line)] bg-[rgba(255,253,248,0.72)] p-3">
                  <strong className="block">{category.title}</strong>
                  <span className="text-xs text-[var(--color-muted)]">{category._count?.articles ?? 0} articles</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card rounded-[1.5rem] p-5">
            <p className="eyebrow">Custom domains</p>
            <h3 className="mt-1 text-xl font-bold">Help center domain</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
              Connect a hostname like help.yourdomain.com. DNS verification is stubbed locally; production would query DNS and enqueue SSL provisioning.
            </p>
            <div className="mt-4 grid gap-3">
              <input
                className="input"
                value={domainInput}
                onChange={(event) => setDomainInput(event.target.value)}
                placeholder="help.example.com"
              />
              <button className="btn-secondary" disabled={isDomainSaving} onClick={() => void connectDomain()}>
                Connect domain
              </button>
            </div>
            {domainMessage ? (
              <p className="mt-3 rounded-2xl border border-[var(--color-line)] bg-[rgba(255,253,248,0.72)] px-3 py-2 text-xs text-[var(--color-muted)]">
                {domainMessage}
              </p>
            ) : null}
            <div className="mt-4 grid gap-3">
              {domains.map((domain) => (
                <div key={domain.id} className="rounded-2xl border border-[var(--color-line)] bg-[rgba(255,253,248,0.72)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <strong className="block break-words">{domain.hostname}</strong>
                      <span className="text-xs text-[var(--color-muted)]">
                        DNS {domain.status.toLowerCase()} · SSL {domain.sslStatus.toLowerCase()}
                      </span>
                    </div>
                    <button
                      className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs font-bold"
                      disabled={isDomainSaving || domain.status === "VERIFIED"}
                      onClick={() => void verifyDomain(domain)}
                    >
                      Verify
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-[var(--color-muted)]">
                    <p>
                      CNAME <strong>{domain.hostname}</strong> to <strong>{workspaceSlug}.ccp-help.local</strong>
                    </p>
                    <p className="break-words">
                      TXT <strong>_ccp-help.{domain.hostname}</strong> = <strong>{domain.verificationToken}</strong>
                    </p>
                    {domain.failureReason ? <p className="text-[var(--color-danger)]">{domain.failureReason}</p> : null}
                  </div>
                </div>
              ))}
              {domains.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-muted)]">
                  No custom domain connected yet.
                </p>
              ) : null}
            </div>
          </div>
        </aside>

        <section className="card rounded-[1.5rem] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="eyebrow">Editor</p>
              <h3 className="mt-1 text-2xl font-bold">
                {activeArticle.id ? "Edit article" : "New article"}
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary px-4 py-2 text-sm" disabled={isSaving} onClick={() => void saveArticle("DRAFT")}>
                Save draft
              </button>
              <button className="btn-primary px-4 py-2 text-sm" disabled={isSaving} onClick={() => void saveArticle("PUBLISHED")}>
                Publish
              </button>
            </div>
          </div>

          {message ? (
            <p className="mt-4 rounded-2xl border border-[var(--color-line)] bg-[rgba(255,253,248,0.72)] px-4 py-3 text-sm text-[var(--color-muted)]">
              {message}
            </p>
          ) : null}

          <div className="mt-5 grid gap-4">
            <input
              className="input text-lg font-bold"
              value={activeArticle.title}
              onChange={(event) => setActiveArticle((previous) => ({ ...previous, title: event.target.value }))}
              placeholder="Article title"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <select
                className="input"
                value={activeArticle.categoryId}
                onChange={(event) => setActiveArticle((previous) => ({ ...previous, categoryId: event.target.value }))}
              >
                <option value="">Uncategorized</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.title}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={activeArticle.status}
                onChange={(event) => setActiveArticle((previous) => ({ ...previous, status: event.target.value as ArticleStatus }))}
              >
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
              </select>
            </div>
            <textarea
              className="input min-h-24 resize-none"
              value={activeArticle.excerpt}
              onChange={(event) => setActiveArticle((previous) => ({ ...previous, excerpt: event.target.value }))}
              placeholder="Short answer shown in search and chat suggestions"
            />

            <div className="rounded-2xl border border-[var(--color-line)] bg-[rgba(255,253,248,0.72)]">
              <div className="flex flex-wrap gap-2 border-b border-[var(--color-line)] p-3">
                <button className="btn-secondary px-3 py-2 text-sm" type="button" onClick={() => command("formatBlock", "h2")}>
                  H2
                </button>
                <button className="btn-secondary px-3 py-2 text-sm" type="button" onClick={() => command("formatBlock", "h3")}>
                  H3
                </button>
                <button className="btn-secondary px-3 py-2 text-sm" type="button" onClick={() => command("bold")}>
                  B
                </button>
                <button className="btn-secondary px-3 py-2 text-sm italic" type="button" onClick={() => command("italic")}>
                  I
                </button>
                <button className="btn-secondary px-3 py-2 text-sm" type="button" onClick={() => command("insertUnorderedList")}>
                  List
                </button>
                <button className="btn-secondary px-3 py-2 text-sm" type="button" onClick={() => command("formatBlock", "blockquote")}>
                  Quote
                </button>
              </div>
              <div
                ref={editorRef}
                className="prose-editor min-h-[420px] max-w-none p-5 text-base leading-7 outline-none"
                contentEditable
                suppressContentEditableWarning
                onInput={() =>
                  setActiveArticle((previous) => ({
                    ...previous,
                    contentHtml: editorRef.current?.innerHTML || previous.contentHtml,
                  }))
                }
              />
            </div>
          </div>
        </section>
      </section>

      <style jsx>{`
        .prose-editor :global(h2) {
          margin: 1.1rem 0 0.45rem;
          font-size: 1.35rem;
          font-weight: 800;
        }
        .prose-editor :global(h3) {
          margin: 1rem 0 0.35rem;
          font-size: 1.1rem;
          font-weight: 800;
        }
        .prose-editor :global(p) {
          margin: 0 0 0.85rem;
        }
        .prose-editor :global(ul),
        .prose-editor :global(ol) {
          margin: 0.75rem 0 0.9rem 1.2rem;
        }
        .prose-editor :global(blockquote) {
          margin: 1rem 0;
          border-left: 3px solid var(--color-accent);
          padding-left: 1rem;
          color: var(--color-muted);
        }
      `}</style>
    </main>
  );
}
