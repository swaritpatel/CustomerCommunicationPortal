"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SupportPolicy = {
  id: string;
  title: string;
  category: string;
  keywords: string[];
  publicGuidance: string;
  internalNotes: string | null;
  autoResolveEnabled: boolean;
  isActive: boolean;
  sortOrder: number;
  updatedAt: string;
};

type DraftPolicy = {
  id?: string;
  title: string;
  category: string;
  keywords: string;
  publicGuidance: string;
  internalNotes: string;
  autoResolveEnabled: boolean;
  isActive: boolean;
  sortOrder: number;
};

const EMPTY_POLICY: DraftPolicy = {
  title: "",
  category: "General",
  keywords: "",
  publicGuidance: "",
  internalNotes: "",
  autoResolveEnabled: false,
  isActive: true,
  sortOrder: 0,
};

const REFUND_EXAMPLE: DraftPolicy = {
  title: "Refund processing timeline",
  category: "Refunds",
  keywords: "refund, cancelled order, cancellation, bank account, payment reversal",
  publicGuidance:
    "Refunds for cancelled orders usually take 4-5 business days to reflect in the customer's original payment method after the refund is initiated.",
  internalNotes:
    "If the customer is asking within the normal 4-5 business day window, answer with the timeline and mark resolved. If it has been more than 5 business days, keep the conversation open for manual review.",
  autoResolveEnabled: true,
  isActive: true,
  sortOrder: 10,
};

function toDraft(policy: SupportPolicy): DraftPolicy {
  return {
    id: policy.id,
    title: policy.title,
    category: policy.category,
    keywords: policy.keywords.join(", "),
    publicGuidance: policy.publicGuidance,
    internalNotes: policy.internalNotes ?? "",
    autoResolveEnabled: policy.autoResolveEnabled,
    isActive: policy.isActive,
    sortOrder: policy.sortOrder,
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function PoliciesAdminClient({ workspaceName }: { workspaceName: string }) {
  const [policies, setPolicies] = useState<SupportPolicy[]>([]);
  const [activePolicy, setActivePolicy] = useState<DraftPolicy>(REFUND_EXAMPLE);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "ALL" | "ARCHIVED">("ACTIVE");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const loadPolicies = useCallback(async () => {
    const response = await fetch("/api/policies", { cache: "no-store" }).catch(() => null);
    if (!response || !response.ok) {
      setMessage("Could not load support policies.");
      return;
    }

    const payload = (await response.json().catch(() => null)) as { policies?: SupportPolicy[] } | null;
    setPolicies(payload?.policies ?? []);
  }, []);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  const filteredPolicies = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return policies.filter((policy) => {
      const matchesStatus =
        status === "ALL" ||
        (status === "ACTIVE" && policy.isActive) ||
        (status === "ARCHIVED" && !policy.isActive);
      const matchesQuery =
        !needle ||
        policy.title.toLowerCase().includes(needle) ||
        policy.category.toLowerCase().includes(needle) ||
        policy.keywords.some((keyword) => keyword.toLowerCase().includes(needle)) ||
        policy.publicGuidance.toLowerCase().includes(needle);

      return matchesStatus && matchesQuery;
    });
  }, [policies, query, status]);

  const activeCount = useMemo(() => policies.filter((policy) => policy.isActive).length, [policies]);
  const autoResolveCount = useMemo(
    () => policies.filter((policy) => policy.isActive && policy.autoResolveEnabled).length,
    [policies],
  );

  const savePolicy = async () => {
    if (!activePolicy.title.trim() || !activePolicy.publicGuidance.trim()) {
      setMessage("Add a title and customer-facing guidance first.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "savePolicy",
          ...activePolicy,
          keywords: activePolicy.keywords,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { policy?: SupportPolicy; error?: string }
        | null;
      if (!response.ok || !payload?.policy) {
        throw new Error(payload?.error ?? "Policy save failed");
      }

      setActivePolicy(toDraft(payload.policy));
      setMessage("Policy saved. The AI agent will use it on matching email and chat conversations.");
      await loadPolicies();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save policy.");
    } finally {
      setIsSaving(false);
    }
  };

  const archivePolicy = async () => {
    if (!activePolicy.id) {
      setMessage("Select a saved policy first.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "archivePolicy", id: activePolicy.id }),
      });
      if (!response.ok) {
        throw new Error("Policy archive failed");
      }

      setActivePolicy(EMPTY_POLICY);
      setMessage("Policy archived.");
      await loadPolicies();
    } catch {
      setMessage("Could not archive policy.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="grid gap-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">Support Policies</p>
          <h2 className="mt-2 text-3xl font-extrabold">AI rules for {workspaceName}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
            Define the business rules your AI agent should reference before replying to email or live chat.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => setActivePolicy(REFUND_EXAMPLE)}>
            Refund example
          </button>
          <button className="btn-primary" onClick={() => setActivePolicy(EMPTY_POLICY)}>
            New policy
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card rounded-[1.25rem] p-5">
          <p className="eyebrow">Active policies</p>
          <strong className="mt-2 block text-3xl">{activeCount}</strong>
        </div>
        <div className="card rounded-[1.25rem] p-5">
          <p className="eyebrow">Auto-resolve enabled</p>
          <strong className="mt-2 block text-3xl">{autoResolveCount}</strong>
        </div>
        <div className="card rounded-[1.25rem] p-5">
          <p className="eyebrow">Total policies</p>
          <strong className="mt-2 block text-3xl">{policies.length}</strong>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[390px_1fr]">
        <aside className="card rounded-[1.5rem] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Library</p>
              <h3 className="mt-1 text-xl font-bold">Policies</h3>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search policies"
            />
            <select className="input" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option value="ACTIVE">Active</option>
              <option value="ALL">All policies</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>
          <div className="mt-4 grid max-h-[620px] gap-2 overflow-auto pr-1">
            {filteredPolicies.map((policy) => (
              <button
                key={policy.id}
                className={`rounded-2xl border p-4 text-left transition ${
                  policy.id === activePolicy.id
                    ? "border-[rgba(182,90,52,0.45)] bg-[var(--color-accent-soft)]"
                    : "border-[var(--color-line)] bg-[rgba(255,253,248,0.72)] hover:border-[var(--color-line-strong)]"
                }`}
                onClick={() => {
                  setActivePolicy(toDraft(policy));
                  setMessage("");
                }}
              >
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-soft)]">
                  {policy.category} · {policy.isActive ? "active" : "archived"}
                </span>
                <strong className="mt-1 block">{policy.title}</strong>
                <span className="mt-1 block text-xs text-[var(--color-muted)]">
                  {policy.autoResolveEnabled ? "Can auto-resolve" : "Keeps conversations open"} · {formatDate(policy.updatedAt)}
                </span>
              </button>
            ))}
            {filteredPolicies.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-muted)]">
                No policies match this view.
              </p>
            ) : null}
          </div>
        </aside>

        <section className="card rounded-[1.5rem] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="eyebrow">Editor</p>
              <h3 className="mt-1 text-2xl font-bold">{activePolicy.id ? "Edit policy" : "New policy"}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {activePolicy.id ? (
                <button className="btn-secondary px-4 py-2 text-sm" disabled={isSaving} onClick={() => void archivePolicy()}>
                  Archive
                </button>
              ) : null}
              <button className="btn-primary px-4 py-2 text-sm" disabled={isSaving} onClick={() => void savePolicy()}>
                Save policy
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
              value={activePolicy.title}
              onChange={(event) => setActivePolicy((previous) => ({ ...previous, title: event.target.value }))}
              placeholder="Policy title"
            />
            <div className="grid gap-4 md:grid-cols-[1fr_180px]">
              <input
                className="input"
                value={activePolicy.category}
                onChange={(event) => setActivePolicy((previous) => ({ ...previous, category: event.target.value }))}
                placeholder="Category"
              />
              <input
                className="input"
                type="number"
                value={activePolicy.sortOrder}
                onChange={(event) => setActivePolicy((previous) => ({ ...previous, sortOrder: Number(event.target.value) || 0 }))}
                placeholder="Sort order"
              />
            </div>
            <input
              className="input"
              value={activePolicy.keywords}
              onChange={(event) => setActivePolicy((previous) => ({ ...previous, keywords: event.target.value }))}
              placeholder="Keywords, comma separated"
            />
            <textarea
              className="input min-h-36 resize-none"
              value={activePolicy.publicGuidance}
              onChange={(event) => setActivePolicy((previous) => ({ ...previous, publicGuidance: event.target.value }))}
              placeholder="Customer-facing guidance the AI can safely say"
            />
            <textarea
              className="input min-h-36 resize-none"
              value={activePolicy.internalNotes}
              onChange={(event) => setActivePolicy((previous) => ({ ...previous, internalNotes: event.target.value }))}
              placeholder="Internal decision notes, escalation rules, and exceptions"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[rgba(255,253,248,0.72)] p-4 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={activePolicy.autoResolveEnabled}
                  onChange={(event) => setActivePolicy((previous) => ({ ...previous, autoResolveEnabled: event.target.checked }))}
                />
                Allow AI to resolve when this policy fully answers the request
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[rgba(255,253,248,0.72)] p-4 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={activePolicy.isActive}
                  onChange={(event) => setActivePolicy((previous) => ({ ...previous, isActive: event.target.checked }))}
                />
                Active
              </label>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
