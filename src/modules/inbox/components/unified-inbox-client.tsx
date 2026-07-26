"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

import { connectConversationSocket } from "@/modules/realtime/client";

type ChannelFilter = "ALL" | "CHAT_WIDGET" | "EMAIL";
type StatusFilter = "ALL" | "OPEN" | "SNOOZED" | "RESOLVED";
type ConversationStatus = "OPEN" | "SNOOZED" | "RESOLVED";
type ConversationChannel = "EMAIL" | "CHAT_WIDGET";

type Member = {
  id: string;
  fullName: string;
  email: string;
  role: "ADMIN" | "AGENT";
};

type InboxConversation = {
  id: string;
  subject: string;
  channel: ConversationChannel;
  customerName: string | null;
  customerEmail: string | null;
  status: ConversationStatus;
  updatedAt: string;
  createdAt: string;
  currentAssigneeId: string | null;
  currentAssignee: { id: string; fullName: string; email: string } | null;
  unreadCount: number;
  visitorOnline: boolean;
  latestMessage: { body: string; createdAt: string; senderType: string } | null;
  sla: {
    firstResponseMinutes: number | null;
    firstResponseBreach: boolean;
    resolutionHours: number;
    resolutionBreach: boolean;
  };
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

type TimelineEvent = {
  conversationId: string;
  subject: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  updatedAt: string;
  latestMessage: { body: string; senderType: string; createdAt: string } | null;
};

type AnalyticsPayload = {
  totals: {
    conversations: number;
    resolved: number;
    open: number;
    snoozed: number;
    resolutionRate: number;
  };
  byChannel: { EMAIL: number; CHAT_WIDGET: number };
  firstResponse: { medianMinutes: number; breaches: number };
  resolution: { medianHours: number; breaches: number };
};

type ConversationSummary = {
  summary: string;
  userWants: string[];
  tried: string[];
  currentStatus: string;
  keyDetails: string[];
  generatedAt: string;
  source: "llm" | "fallback";
  model?: string;
};

type CannedResponse = {
  id: string;
  tag: string;
  body: string;
};

type GmailStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  lastSyncedAt: string | null;
};

const DEFAULT_CANNED_RESPONSES: CannedResponse[] = [
  {
    id: "ack-1",
    tag: "ack",
    body: "We appreciate your patience while our team reviews the details.",
  },
  {
    id: "details-1",
    tag: "details",
    body: "Could you share one screenshot and the exact time this happened so we can investigate faster?",
  },
  {
    id: "resolved-1",
    tag: "resolved",
    body: "This is now resolved on our side. Please refresh and let us know if anything still looks off.",
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
    // Ignore malformed local cache.
  }

  return DEFAULT_CANNED_RESPONSES;
}

function formatRelative(isoDate: string) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (diffMinutes < 1) {
    return "now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }
  return `${Math.round(diffHours / 24)}d`;
}

function channelLabel(channel: ConversationChannel) {
  return channel === "EMAIL" ? "Email" : "Chat";
}

function customerLabel(conversation: InboxConversation) {
  return (
    conversation.customerName ||
    conversation.customerEmail ||
    (conversation.channel === "EMAIL" ? "Email customer" : "Website visitor")
  );
}

export function UnifiedInboxClient() {
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("OPEN");
  const [assigneeFilter, setAssigneeFilter] = useState("ALL");
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [viewer, setViewer] = useState<{ id: string; role: "ADMIN" | "AGENT" } | null>(null);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [summary, setSummary] = useState<ConversationSummary | null>(null);
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>(DEFAULT_CANNED_RESPONSES);
  const [newCannedTag, setNewCannedTag] = useState("");
  const [newCannedBody, setNewCannedBody] = useState("");
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [isGmailSyncing, setIsGmailSyncing] = useState(false);
  const [gmailMessage, setGmailMessage] = useState("");
  const cannedResponsesLoadedRef = useRef(false);
  const gmailSyncingRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );
  const messageSignature = useMemo(
    () => `${activeId}:${messages.length}:${messages[messages.length - 1]?.id ?? ""}`,
    [activeId, messages],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      cannedResponsesLoadedRef.current = true;
      setCannedResponses(readStoredCannedResponses());
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!cannedResponsesLoadedRef.current) {
      return;
    }
    window.localStorage.setItem("relaydesk.cannedResponses", JSON.stringify(cannedResponses));
  }, [cannedResponses]);

  const loadConversations = useCallback(async () => {
    const params = new URLSearchParams();
    if (channelFilter !== "ALL") {
      params.set("channel", channelFilter);
    }
    if (statusFilter !== "ALL") {
      params.set("status", statusFilter);
    }
    if (assigneeFilter !== "ALL") {
      params.set("assignee", assigneeFilter);
    }

    const response = await fetch(`/api/inbox/conversations?${params.toString()}`, {
      cache: "no-store",
    }).catch(() => null);

    if (!response || !response.ok) {
      return;
    }

    const payload = await response.json();
    const items = (payload.conversations ?? []) as InboxConversation[];
    setConversations(items);
    setMembers(payload.members ?? []);
    setViewer(payload.viewer ?? null);

    if (!activeId || !items.some((conversation) => conversation.id === activeId)) {
      setActiveId(items[0]?.id ?? "");
    }
  }, [activeId, assigneeFilter, channelFilter, statusFilter]);

  const loadMessages = useCallback(async (conversationId: string) => {
    const response = await fetch(`/api/inbox/messages?conversationId=${encodeURIComponent(conversationId)}`, {
      cache: "no-store",
    }).catch(() => null);

    if (!response || !response.ok) {
      return;
    }

    const payload = await response.json();
    setMessages(payload.messages ?? []);
    setTimeline(payload.timeline ?? []);
  }, []);

  const loadAnalytics = useCallback(async () => {
    const response = await fetch("/api/inbox/analytics", { cache: "no-store" }).catch(() => null);
    if (!response || !response.ok) {
      return;
    }

    setAnalytics((await response.json()) as AnalyticsPayload);
  }, []);

  const loadGmailStatus = useCallback(async () => {
    const response = await fetch("/api/email/gmail/status", { cache: "no-store" }).catch(() => null);
    if (!response || !response.ok) {
      return;
    }

    setGmailStatus((await response.json()) as GmailStatus);
  }, []);

  const loadSummary = useCallback(async (conversationId: string) => {
    setIsSummarizing(true);
    try {
      const response = await fetch("/api/inbox/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId }),
      }).catch(() => null);

      if (!response || !response.ok) {
        return;
      }

      const payload = (await response.json()) as { summary?: ConversationSummary };
      setSummary(payload.summary ?? null);
    } finally {
      setIsSummarizing(false);
    }
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
    const timeout = window.setTimeout(() => {
      void loadGmailStatus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadGmailStatus]);

  useEffect(() => {
    if (!activeId) {
      const timeout = window.setTimeout(() => {
        setMessages([]);
        setTimeline([]);
      }, 0);
      return () => window.clearTimeout(timeout);
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
    if (!activeId || messages.length === 0) {
      const timeout = window.setTimeout(() => setSummary(null), 0);
      return () => window.clearTimeout(timeout);
    }

    const timeout = window.setTimeout(() => {
      void loadSummary(activeId);
    }, 420);

    return () => window.clearTimeout(timeout);
  }, [activeId, messageSignature, messages.length, loadSummary]);

  useEffect(() => {
    if (!activeId) {
      return;
    }

    socketRef.current?.disconnect();
    socketRef.current = connectConversationSocket({
      conversationId: activeId,
      onEvent: (event) => {
        if (event.conversationId === activeId) {
          void Promise.all([
            loadConversations(),
            loadMessages(activeId),
            loadAnalytics(),
          ]);
        }
      },
    });

    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [activeId, loadAnalytics, loadConversations, loadMessages]);

  const refreshActive = useCallback(async () => {
    await Promise.all([
      loadConversations(),
      activeId ? loadMessages(activeId) : Promise.resolve(),
      loadAnalytics(),
      loadGmailStatus(),
    ]);
  }, [activeId, loadAnalytics, loadConversations, loadGmailStatus, loadMessages]);

  const syncGmail = useCallback(async (options?: { quiet?: boolean }) => {
    if (gmailSyncingRef.current) {
      return;
    }

    gmailSyncingRef.current = true;
    setIsGmailSyncing(true);
    if (!options?.quiet) {
      setGmailMessage("");
    }
    try {
      const response = await fetch("/api/email/gmail/sync", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { imported?: number; skipped?: number; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Gmail sync failed");
      }

      if (!options?.quiet || (payload?.imported ?? 0) > 0) {
        setGmailMessage(`Imported ${payload?.imported ?? 0}, skipped ${payload?.skipped ?? 0}.`);
      }
      await refreshActive();
    } catch (error) {
      if (!options?.quiet) {
        setGmailMessage(error instanceof Error ? error.message : "Gmail sync failed");
      }
    } finally {
      gmailSyncingRef.current = false;
      setIsGmailSyncing(false);
    }
  }, [refreshActive]);

  useEffect(() => {
    if (!gmailStatus?.connected) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void syncGmail({ quiet: true });
    }, 800);
    const interval = window.setInterval(() => {
      void syncGmail({ quiet: true });
    }, 30_000);

    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [gmailStatus?.connected, syncGmail]);

  const sendReply = async () => {
    const trimmed = text.trim();
    if (!activeId || !trimmed || isSending) {
      return;
    }

    setIsSending(true);
    try {
      const response = await fetch("/api/inbox/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, text: trimmed }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to send reply");
      }

      setText("");
      await refreshActive();
    } catch (error) {
      console.error("[inbox:reply_failed]", error);
    } finally {
      setIsSending(false);
    }
  };

  const updateStatus = async (status: ConversationStatus) => {
    if (!activeId || isMutating) {
      return;
    }

    setIsMutating(true);
    try {
      const response = await fetch("/api/inbox/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, status }),
      });

      if (!response.ok) {
        throw new Error("Failed to update status");
      }

      await refreshActive();
    } catch (error) {
      console.error("[inbox:status_failed]", error);
    } finally {
      setIsMutating(false);
    }
  };

  const assignConversation = async (assigneeId: string) => {
    if (!activeId || isMutating) {
      return;
    }

    setIsMutating(true);
    try {
      const response = await fetch("/api/inbox/assignment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: activeId,
          assigneeId: assigneeId || null,
          reason: "Unified inbox assignment",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to assign conversation");
      }

      await refreshActive();
    } catch (error) {
      console.error("[inbox:assignment_failed]", error);
    } finally {
      setIsMutating(false);
    }
  };

  const draftReply = async () => {
    if (!activeId || isDrafting) {
      return;
    }

    setIsDrafting(true);
    try {
      const response = await fetch("/api/inbox/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: activeId,
          cannedResponses: cannedResponses.map((responseItem) => responseItem.body),
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

  const insertCanned = (body: string) => {
    setText((current) => (current.trim().length > 0 ? `${current}\n\n${body}` : body));
  };

  const saveCanned = () => {
    const tag = newCannedTag.trim();
    const body = newCannedBody.trim();
    if (!tag || !body) {
      return;
    }

    setCannedResponses((current) => [{ id: `${Date.now()}`, tag, body }, ...current]);
    setNewCannedTag("");
    setNewCannedBody("");
  };

  return (
    <main className="min-h-screen px-6 py-8 sm:px-8 lg:px-10">
      <div className="mx-auto grid w-full max-w-7xl gap-6 xl:grid-cols-[320px_1fr_310px]">
        <aside className="card rounded-[2rem] p-5">
          <p className="eyebrow">Unified Inbox</p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">All conversations</h1>

          <div className="mt-5 rounded-2xl border border-[var(--color-line)] bg-[rgba(255,255,255,0.65)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-muted)]">Gmail</p>
                <p className="mt-1 truncate text-sm font-bold">
                  {gmailStatus?.connected ? gmailStatus.email : "Not connected"}
                </p>
                {gmailStatus?.lastSyncedAt ? (
                  <p className="mt-1 text-xs text-[var(--color-muted)]">
                    Synced {formatRelative(gmailStatus.lastSyncedAt)} ago
                  </p>
                ) : null}
              </div>
              {gmailStatus?.connected ? (
                <button
                  className="btn-secondary shrink-0 px-3 py-2 text-xs"
                  disabled={isGmailSyncing}
                  onClick={() => void syncGmail()}
                >
                  {isGmailSyncing ? "Syncing" : "Sync"}
                </button>
              ) : (
                <a className="btn-primary shrink-0 px-3 py-2 text-xs" href="/api/auth/google/start">
                  Connect
                </a>
              )}
            </div>
            {gmailStatus && !gmailStatus.configured ? (
              <p className="mt-2 text-xs text-[#a63926]">Google OAuth env vars are missing.</p>
            ) : null}
            {gmailMessage ? <p className="mt-2 text-xs text-[var(--color-muted)]">{gmailMessage}</p> : null}
          </div>

          <div className="mt-5 grid gap-3">
            <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-muted)]">
              Channel
              <select className="input" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value as ChannelFilter)}>
                <option value="ALL">All channels</option>
                <option value="CHAT_WIDGET">Chat</option>
                <option value="EMAIL">Email</option>
              </select>
            </label>

            <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-muted)]">
              Status
              <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                <option value="ALL">All statuses</option>
                <option value="OPEN">Open</option>
                <option value="SNOOZED">Snoozed</option>
                <option value="RESOLVED">Resolved</option>
              </select>
            </label>

            <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-muted)]">
              Assignee
              <select className="input" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
                <option value="ALL">Anyone</option>
                <option value="ME">Assigned to me</option>
                <option value="UNASSIGNED">Unassigned</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {analytics ? (
            <div className="mt-5 grid grid-cols-2 gap-3">
              {[
                ["Open", analytics.totals.open],
                ["Snoozed", analytics.totals.snoozed],
                ["Email", analytics.byChannel.EMAIL],
                ["Chat", analytics.byChannel.CHAT_WIDGET],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-[var(--color-line)] bg-[rgba(255,255,255,0.62)] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-muted)]">{label}</p>
                  <p className="mt-1 text-xl font-extrabold">{value}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-5 grid max-h-[560px] gap-3 overflow-auto pr-1">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={`min-w-0 rounded-2xl border px-4 py-3 text-left transition ${
                  conversation.id === activeId
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                    : "border-[var(--color-line)] bg-[rgba(255,255,255,0.65)]"
                }`}
                onClick={() => setActiveId(conversation.id)}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <strong className="min-w-0 truncate text-sm">{customerLabel(conversation)}</strong>
                  <span className="shrink-0 rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[10px] font-bold uppercase">
                    {channelLabel(conversation.channel)}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--color-muted)]">{conversation.latestMessage?.body || conversation.subject}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.08em]">
                  {conversation.unreadCount > 0 ? (
                    <span className="rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-white">{conversation.unreadCount} new</span>
                  ) : null}
                  {conversation.sla.firstResponseBreach || conversation.sla.resolutionBreach ? (
                    <span className="rounded-full bg-[rgba(224,75,54,0.14)] px-2 py-0.5 text-[#a63926]">SLA</span>
                  ) : null}
                  <span className="text-[var(--color-muted)]">{formatRelative(conversation.updatedAt)} ago</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="card rounded-[2rem] p-5">
          {activeConversation ? (
            <>
              <header className="border-b border-[var(--color-line)] pb-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <p className="eyebrow">{channelLabel(activeConversation.channel)} thread</p>
                    <h2 className="mt-2 max-w-2xl break-words text-2xl font-extrabold">
                      {activeConversation.subject}
                    </h2>
                    <p className="mt-1 max-w-2xl break-words text-sm text-[var(--color-muted)]">
                      {customerLabel(activeConversation)} · {activeConversation.customerEmail || "No email"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full border border-[var(--color-line)] px-3 py-1 text-xs font-bold uppercase tracking-[0.08em]">
                        {activeConversation.status}
                      </span>
                      <span className="rounded-full border border-[var(--color-line)] px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-muted)]">
                        {activeConversation.currentAssignee?.fullName ?? "Unassigned"}
                      </span>
                      {activeConversation.visitorOnline ? (
                        <span className="rounded-full bg-[rgba(42,157,87,0.14)] px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-[#1f7a43]">
                          Online
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2 xl:justify-end">
                    <button className="btn-secondary min-w-24 px-4 py-2 text-sm whitespace-nowrap" disabled={isMutating || activeConversation.status === "OPEN"} onClick={() => void updateStatus("OPEN")}>
                      Reopen
                    </button>
                    <button className="btn-secondary min-w-24 px-4 py-2 text-sm whitespace-nowrap" disabled={isMutating || activeConversation.status === "SNOOZED"} onClick={() => void updateStatus("SNOOZED")}>
                      Snooze
                    </button>
                    <button className="btn-primary min-w-24 px-4 py-2 text-sm whitespace-nowrap" disabled={isMutating || activeConversation.status === "RESOLVED"} onClick={() => void updateStatus("RESOLVED")}>
                      Resolve
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <select
                    className="input"
                    value={activeConversation.currentAssigneeId ?? ""}
                    onChange={(event) => void assignConversation(event.target.value)}
                    disabled={viewer?.role !== "ADMIN" || isMutating}
                  >
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.fullName} ({member.role})
                      </option>
                    ))}
                  </select>
                  <span className="self-center text-xs text-[var(--color-muted)]">
                    {viewer?.role === "ADMIN" ? "Admin assignment controls" : "Assignment is admin-only"}
                  </span>
                </div>
              </header>

              <div className="mt-4 grid max-h-[520px] gap-3 overflow-auto pr-2">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[84%] rounded-2xl border px-4 py-3 shadow-[0_6px_18px_rgba(42,37,31,0.06)] ${
                      message.senderType === "AGENT"
                        ? "ml-auto border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                        : "border-[var(--color-line)] bg-[rgba(255,255,255,0.78)]"
                    }`}
                  >
                    <p className={`text-xs font-semibold ${message.senderType === "AGENT" ? "text-[rgba(255,255,255,0.8)]" : "text-[var(--color-soft)]"}`}>
                      {message.senderType === "AGENT"
                        ? message.senderUser?.fullName || "Cosmofeed Support"
                        : message.senderType === "SYSTEM"
                          ? "CCP Support"
                          : customerLabel(activeConversation)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{message.body}</p>
                  </div>
                ))}
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
                  placeholder={activeConversation.channel === "EMAIL" ? "Reply by email" : "Reply in chat"}
                />
                <div className="grid gap-2 self-end">
                  <button className="btn-secondary" onClick={() => void draftReply()} disabled={isDrafting}>
                    {isDrafting ? "Drafting..." : "AI draft"}
                  </button>
                  <button className="btn-primary" onClick={() => void sendReply()} disabled={isSending || text.trim().length === 0}>
                    {isSending ? "Sending..." : "Send"}
                  </button>
                </div>
              </footer>
            </>
          ) : (
            <div className="flex h-full min-h-[520px] items-center justify-center text-[var(--color-muted)]">
              No conversations match these filters.
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <article className="card rounded-[2rem] p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">AI Summary</p>
                <h3 className="mt-1 text-lg font-extrabold tracking-[-0.03em]">Issue snapshot</h3>
              </div>
              <button
                className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs font-bold"
                disabled={!activeId || isSummarizing}
                onClick={() => activeId ? void loadSummary(activeId) : undefined}
              >
                {isSummarizing ? "Updating" : "Refresh"}
              </button>
            </div>
            {summary ? (
              <div className="mt-4 grid gap-4 text-sm">
                <p className="leading-6 text-[var(--color-muted)]">{summary.summary}</p>
                {[
                  ["User wants", summary.userWants],
                  ["Tried", summary.tried],
                  ["Key details", summary.keyDetails],
                ].map(([label, items]) => (
                  <div key={label as string}>
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-soft)]">{label as string}</p>
                    {(items as string[]).length > 0 ? (
                      <ul className="mt-2 grid gap-1 text-xs leading-5 text-[var(--color-muted)]">
                        {(items as string[]).map((item) => (
                          <li key={item} className="rounded-xl border border-[var(--color-line)] bg-[rgba(255,255,255,0.62)] px-3 py-2">
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-[var(--color-muted)]">No details yet.</p>
                    )}
                  </div>
                ))}
                <div className="rounded-2xl border border-[var(--color-line)] bg-[rgba(255,255,255,0.62)] p-3">
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-soft)]">Current status</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">{summary.currentStatus}</p>
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-soft)]">
                  {summary.source === "llm" ? `LLM${summary.model ? ` · ${summary.model}` : ""}` : "Fallback summary"} · {formatRelative(summary.generatedAt)} ago
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-[var(--color-muted)]">
                {isSummarizing ? "Generating the latest issue summary..." : "Open a conversation with messages to generate a summary."}
              </p>
            )}
          </article>

          <article className="card rounded-[2rem] p-5">
            <p className="eyebrow">SLA Health</p>
            {activeConversation ? (
              <div className="mt-4 grid gap-3 text-sm">
                <div className="rounded-2xl border border-[var(--color-line)] bg-[rgba(255,255,255,0.62)] p-4">
                  <p className="font-bold">First response</p>
                  <p className="mt-1 text-[var(--color-muted)]">
                    {activeConversation.sla.firstResponseMinutes === null
                      ? "No customer message yet"
                      : `${Math.round(activeConversation.sla.firstResponseMinutes)}m elapsed`}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--color-line)] bg-[rgba(255,255,255,0.62)] p-4">
                  <p className="font-bold">Resolution</p>
                  <p className="mt-1 text-[var(--color-muted)]">{Math.round(activeConversation.sla.resolutionHours)}h age</p>
                </div>
              </div>
            ) : null}
            {analytics ? (
              <p className="mt-4 text-xs leading-6 text-[var(--color-muted)]">
                Median first response {Math.round(analytics.firstResponse.medianMinutes)}m · Resolution rate{" "}
                {Math.round(analytics.totals.resolutionRate * 100)}%
              </p>
            ) : null}
          </article>

          <article className="card rounded-[2rem] p-5">
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
            <div className="mt-4 grid gap-2">
              <input className="input" value={newCannedTag} onChange={(event) => setNewCannedTag(event.target.value)} placeholder="Tag" />
              <textarea className="input min-h-[74px]" value={newCannedBody} onChange={(event) => setNewCannedBody(event.target.value)} placeholder="Saved response text" />
              <button className="btn-secondary" onClick={saveCanned}>Save response</button>
            </div>
          </article>

          <article className="card rounded-[2rem] p-5">
            <p className="eyebrow">Contact timeline</p>
            <div className="mt-3 grid max-h-[300px] gap-2 overflow-auto text-xs text-[var(--color-muted)]">
              {timeline.length === 0 ? (
                <p>No linked history yet.</p>
              ) : (
                timeline.map((event) => (
                  <div key={event.conversationId} className="rounded-xl border border-[var(--color-line)] bg-[rgba(255,255,255,0.62)] px-3 py-2">
                    <p className="font-semibold text-[var(--color-ink)]">{event.subject}</p>
                    <p>{channelLabel(event.channel)} · {event.status} · {formatRelative(event.updatedAt)} ago</p>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="card rounded-[2rem] p-5">
            <p className="eyebrow">Operations API</p>
            <p className="mt-3 text-xs leading-6 text-[var(--color-muted)]">
              Unified inbox uses REST endpoints for conversation listing, replies, assignment, status, drafts, and analytics. Email webhooks remain available for inbound and reply-sent events.
            </p>
          </article>
        </aside>
      </div>
    </main>
  );
}
