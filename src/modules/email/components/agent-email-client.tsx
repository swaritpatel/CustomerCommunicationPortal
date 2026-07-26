"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type EmailConversation = {
  id: string;
  subject: string;
  customerName: string | null;
  customerEmail: string | null;
  status: "OPEN" | "SNOOZED" | "RESOLVED";
  updatedAt: string;
  unreadCount: number;
  firstResponseBreach: boolean;
  resolutionBreach: boolean;
  latestMessage: { body: string; createdAt: string; senderType: string } | null;
};

type Message = {
  id: string;
  senderType: "VISITOR" | "AGENT" | "SYSTEM";
  senderUserId: string | null;
  body: string;
  createdAt: string;
  readByVisitorAt: string | null;
  readByAgentAt: string | null;
  senderUser?: { fullName: string };
};

type CannedResponse = {
  id: string;
  tag: string;
  body: string;
};

type TimelineEvent = {
  conversationId: string;
  subject: string;
  status: "OPEN" | "SNOOZED" | "RESOLVED";
  updatedAt: string;
};

type AnalyticsPayload = {
  totals: {
    conversations: number;
    resolved: number;
    resolutionRate: number;
  };
  firstResponse: {
    targetMinutes: number;
    medianMinutes: number;
    breaches: number;
  };
  resolution: {
    targetHours: number;
    medianHours: number;
    breaches: number;
  };
};

const DEFAULT_CANNED_RESPONSES: CannedResponse[] = [
  {
    id: "ack-1",
    tag: "acknowledgement",
    body: "We appreciate your patience while our team reviews the details.",
  },
  {
    id: "followup-1",
    tag: "follow-up",
    body: "Could you share one screenshot and the exact time this happened so we can investigate faster?",
  },
  {
    id: "resolve-1",
    tag: "resolution",
    body: "This is now fixed on our side. Please refresh and let us know if you still see the issue.",
  },
];

function readStoredCannedResponses() {
  if (typeof window === "undefined") {
    return DEFAULT_CANNED_RESPONSES;
  }

  const stored = window.localStorage.getItem("relaydesk.cannedResponses");
  if (!stored) {
    return DEFAULT_CANNED_RESPONSES;
  }

  try {
    const parsed = JSON.parse(stored) as CannedResponse[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // Ignore malformed local data and keep defaults.
  }

  return DEFAULT_CANNED_RESPONSES;
}

export function AgentEmailClient() {
  const [conversations, setConversations] = useState<EmailConversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>(readStoredCannedResponses);
  const [newCannedTag, setNewCannedTag] = useState("");
  const [newCannedBody, setNewCannedBody] = useState("");

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );

  useEffect(() => {
    window.localStorage.setItem("relaydesk.cannedResponses", JSON.stringify(cannedResponses));
  }, [cannedResponses]);

  const loadConversations = useCallback(async () => {
    const response = await fetch("/api/email/conversations", { cache: "no-store" }).catch(() => null);
    if (!response || !response.ok) {
      return;
    }

    const payload = await response.json();
    const items = payload.conversations ?? [];
    setConversations(items);
    if (!activeId && items.length > 0) {
      setActiveId(items[0].id);
    }
  }, [activeId]);

  const loadAnalytics = useCallback(async () => {
    const response = await fetch("/api/email/analytics", { cache: "no-store" }).catch(() => null);
    if (!response || !response.ok) {
      return;
    }

    const payload = (await response.json()) as AnalyticsPayload;
    setAnalytics(payload);
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    const response = await fetch(`/api/email/messages?conversationId=${conversationId}`, {
      cache: "no-store",
    }).catch(() => null);
    if (!response || !response.ok) {
      return;
    }

    const payload = await response.json();
    setMessages(payload.messages ?? []);
  }, []);

  const loadTimeline = useCallback(async (conversationId: string) => {
    const response = await fetch(`/api/email/contact-timeline?conversationId=${conversationId}`, {
      cache: "no-store",
    }).catch(() => null);

    if (!response || !response.ok) {
      return;
    }

    const payload = await response.json();
    setTimeline(payload.events ?? []);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadConversations();
    }, 0);
    const interval = window.setInterval(() => {
      void loadConversations();
    }, 8_000);

    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [loadConversations]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadAnalytics();
    }, 0);
    const interval = window.setInterval(() => {
      void loadAnalytics();
    }, 20_000);

    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [loadAnalytics]);

  useEffect(() => {
    if (!activeId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadMessages(activeId);
    }, 0);
    const interval = window.setInterval(() => {
      void loadMessages(activeId);
    }, 8_000);

    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [activeId, loadMessages]);

  useEffect(() => {
    if (!activeId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadTimeline(activeId);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [activeId, loadTimeline]);

  const sendReply = async () => {
    const trimmed = text.trim();
    if (!activeId || !trimmed || isSending) {
      return;
    }

    setIsSending(true);
    try {
      const response = await fetch("/api/email/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, text: trimmed }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to send reply");
      }

      setText("");

      await Promise.all([
        loadMessages(activeId),
        loadConversations(),
        loadAnalytics(),
        loadTimeline(activeId),
      ]);
    } catch (error) {
      console.error("[email:reply_failed]", error);
    } finally {
      setIsSending(false);
    }
  };

  const insertCanned = (body: string) => {
    setText((current) => (current.trim().length > 0 ? `${current}\n\n${body}` : body));
  };

  const updateStatus = async (status: EmailConversation["status"]) => {
    if (!activeId || isUpdatingStatus) {
      return;
    }

    setIsUpdatingStatus(true);
    try {
      const response = await fetch("/api/email/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, status }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to update status");
      }

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === activeId
            ? { ...conversation, status, updatedAt: new Date().toISOString() }
            : conversation,
        ),
      );

      await Promise.all([
        loadConversations(),
        loadAnalytics(),
        loadTimeline(activeId),
      ]);
    } catch (error) {
      console.error("[email:status_failed]", error);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const saveCanned = () => {
    const tag = newCannedTag.trim();
    const body = newCannedBody.trim();
    if (!tag || !body) {
      return;
    }

    const entry: CannedResponse = {
      id: `${Date.now()}`,
      tag,
      body,
    };

    setCannedResponses((current) => [entry, ...current]);
    setNewCannedTag("");
    setNewCannedBody("");
  };

  const draftReply = async () => {
    if (!activeId || isDrafting) {
      return;
    }

    setIsDrafting(true);
    try {
      const response = await fetch("/api/email/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: activeId,
          cannedResponses: cannedResponses.map((item) => item.body),
        }),
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { draft?: string };
      if (payload.draft) {
        setText(payload.draft);
      }
    } finally {
      setIsDrafting(false);
    }
  };

  return (
    <main className="min-h-screen px-6 py-8 sm:px-8 lg:px-10">
      <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[340px_1fr]">
        <aside className="card rounded-[2rem] p-5">
          <p className="eyebrow">Email Inbox</p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">Customer emails</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Incoming support emails with full thread continuity.
          </p>

          <div className="mt-5 grid gap-3">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                onClick={() => setActiveId(conversation.id)}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  conversation.id === activeId
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                    : "border-[var(--color-line)] bg-[rgba(255,255,255,0.65)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-sm">{conversation.customerEmail || "Unknown sender"}</strong>
                  {conversation.unreadCount > 0 ? (
                    <span className="rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-xs font-bold text-white">
                      {conversation.unreadCount}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-xs text-[var(--color-muted)]">{conversation.subject}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.08em]">
                  {conversation.firstResponseBreach ? (
                    <span className="rounded-full bg-[rgba(224,75,54,0.14)] px-2 py-0.5 text-[#a63926]">
                      First response SLA breached
                    </span>
                  ) : null}
                  {conversation.resolutionBreach ? (
                    <span className="rounded-full bg-[rgba(224,75,54,0.14)] px-2 py-0.5 text-[#a63926]">
                      Resolution SLA breached
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>

          {analytics ? (
            <div className="mt-6 rounded-2xl border border-[var(--color-line)] bg-[rgba(255,255,255,0.72)] p-4">
              <p className="eyebrow">Analytics</p>
              <p className="mt-2 text-xs text-[var(--color-muted)]">
                Resolution rate: {Math.round(analytics.totals.resolutionRate * 100)}% · Median first response:
                {" "}
                {Math.round(analytics.firstResponse.medianMinutes)}m
              </p>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                First-response breaches: {analytics.firstResponse.breaches} · Resolution breaches:
                {" "}
                {analytics.resolution.breaches}
              </p>
            </div>
          ) : null}
        </aside>

        <section className="card rounded-[2rem] p-5">
          {activeConversation ? (
            <>
              <header className="border-b border-[var(--color-line)] pb-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="eyebrow">Thread</p>
                    <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">{activeConversation.subject}</h2>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {activeConversation.customerName || "Customer"} · {activeConversation.customerEmail || "No email"}
                    </p>
                    <span className="mt-3 inline-flex rounded-full border border-[var(--color-line)] bg-[rgba(255,255,255,0.72)] px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-muted)]">
                      {activeConversation.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn-secondary"
                      onClick={() => void updateStatus("OPEN")}
                      disabled={isUpdatingStatus || activeConversation.status === "OPEN"}
                    >
                      Reopen
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => void updateStatus("SNOOZED")}
                      disabled={isUpdatingStatus || activeConversation.status === "SNOOZED"}
                    >
                      Snooze
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => void updateStatus("RESOLVED")}
                      disabled={isUpdatingStatus || activeConversation.status === "RESOLVED"}
                    >
                      Resolve
                    </button>
                  </div>
                </div>
              </header>

              <div className="mt-4 grid max-h-[480px] gap-3 overflow-auto pr-2">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[92%] rounded-2xl border px-4 py-3 ${
                      message.senderType === "AGENT"
                        ? "ml-auto border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                        : "border-[var(--color-line)] bg-[rgba(255,255,255,0.78)]"
                    }`}
                  >
                    {message.senderType === "AGENT" && message.senderUser?.fullName ? (
                      <p className="text-xs font-semibold text-[rgba(255,255,255,0.8)]">{message.senderUser.fullName}</p>
                    ) : null}
                    {message.senderType === "SYSTEM" ? (
                      <p className="text-xs font-semibold text-[var(--color-soft)]">Cosmofeed Support</p>
                    ) : null}
                    <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-[var(--color-line)] bg-[rgba(255,255,255,0.65)] p-4">
                <p className="eyebrow">Contact timeline</p>
                <div className="mt-2 grid max-h-[160px] gap-2 overflow-auto text-xs text-[var(--color-muted)]">
                  {timeline.slice(0, 8).map((event) => (
                    <div key={event.conversationId} className="rounded-xl border border-[var(--color-line)] px-3 py-2">
                      <p className="font-semibold text-[var(--color-ink)]">{event.subject}</p>
                      <p>{new Date(event.updatedAt).toLocaleString()} · {event.status}</p>
                    </div>
                  ))}
                </div>
              </div>

              <footer className="mt-4 grid grid-cols-[1fr_auto] gap-3 border-t border-[var(--color-line)] pt-4">
                <textarea
                  className="input min-h-[100px]"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void sendReply();
                    }
                  }}
                  placeholder="Reply to customer email"
                />
                <div className="grid gap-2 self-end">
                  <button className="btn-secondary" onClick={() => void draftReply()} disabled={isDrafting}>
                    {isDrafting ? "Drafting..." : "AI draft"}
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => void sendReply()}
                    disabled={isSending || text.trim().length === 0}
                  >
                    {isSending ? "Sending..." : "Send reply"}
                  </button>
                </div>
              </footer>

              <section className="mt-4 rounded-2xl border border-[var(--color-line)] bg-[rgba(255,255,255,0.65)] p-4">
                <p className="eyebrow">Canned responses</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {cannedResponses.map((response) => (
                    <button
                      key={response.id}
                      className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs font-semibold"
                      onClick={() => insertCanned(response.body)}
                    >
                      {response.tag}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[140px_1fr_auto]">
                  <input
                    className="input"
                    value={newCannedTag}
                    onChange={(event) => setNewCannedTag(event.target.value)}
                    placeholder="Tag"
                  />
                  <input
                    className="input"
                    value={newCannedBody}
                    onChange={(event) => setNewCannedBody(event.target.value)}
                    placeholder="Saved response text"
                  />
                  <button className="btn-secondary" onClick={saveCanned}>
                    Save
                  </button>
                </div>
              </section>
            </>
          ) : (
            <div className="flex h-full min-h-[420px] items-center justify-center text-[var(--color-muted)]">
              Waiting for first inbound email.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
