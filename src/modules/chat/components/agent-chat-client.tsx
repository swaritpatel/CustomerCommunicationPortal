"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

import { connectConversationSocket } from "@/modules/realtime/client";

type ConversationItem = {
  id: string;
  subject: string;
  customerName: string | null;
  customerEmail: string | null;
  status: "OPEN" | "SNOOZED" | "RESOLVED";
  updatedAt: string;
  visitorOnline: boolean;
  unreadCount: number;
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

export function AgentChatClient() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [agentTyping, setAgentTyping] = useState(false);
  const [visitorTyping, setVisitorTyping] = useState(false);
  const [agentOnline, setAgentOnline] = useState(false);
  const typingDebounceRef = useRef<number | null>(null);
  const lastTypingValueRef = useRef(false);
  const streamRef = useRef<EventSource | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const socketHealthyRef = useRef(false);
  const streamHealthyRef = useRef(false);
  const lastStreamEventAtRef = useRef(0);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );

  const dedupeMessages = (items: Message[]) => {
    const seen = new Set<string>();
    const result: Message[] = [];
    for (const message of items) {
      if (!seen.has(message.id)) {
        seen.add(message.id);
        result.push(message);
      }
    }
    return result;
  };

  const getInitials = (name: string) => {
    const tokens = name.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return "A";
    }
    return tokens
      .slice(0, 2)
      .map((token) => token[0]?.toUpperCase() ?? "")
      .join("");
  };

  const formatMessageTime = (isoDate: string) => {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  };

  useEffect(() => {
    const loadConversations = async () => {
      const response = await fetch("/api/chat/conversations", { cache: "no-store" }).catch(
        (error: unknown) => {
          console.error("[chat:agent_conversations_failed]", error);
          return null;
        },
      );
      if (!response || !response.ok) {
        if (response && !response.ok) {
          console.warn("[chat:agent_conversations_bad_status]", response.status);
        }
        return;
      }

      const payload = await response.json();
      const items = payload.conversations ?? [];
      setConversations(items);
      if (!activeId && items.length > 0) {
        setActiveId(items[0].id);
      }
    };

    void loadConversations();
    const interval = window.setInterval(() => {
      void loadConversations();
    }, 10_000);

    return () => window.clearInterval(interval);
  }, [activeId]);

  useEffect(() => {
    if (!activeId) {
      return;
    }

    const sync = async () => {
      const response = await fetch(`/api/chat/messages?conversationId=${activeId}`, {
        cache: "no-store",
      }).catch((error: unknown) => {
        console.error("[chat:agent_sync_failed]", error);
        return null;
      });
      if (!response || !response.ok) {
        if (response && !response.ok) {
          console.warn("[chat:agent_sync_bad_status]", response.status);
        }
        return;
      }

      const payload = await response.json();
      setMessages(dedupeMessages(payload.messages ?? []));
      setVisitorTyping(Boolean(payload.meta?.visitorTyping));
      setAgentTyping(Boolean(payload.meta?.agentTyping));
      setAgentOnline(Boolean(payload.meta?.agentOnline));
    };

    const connectStream = () => {
      streamRef.current?.close();
      const source = new EventSource(`/api/chat/stream?conversationId=${encodeURIComponent(activeId)}`);
      streamRef.current = source;

      source.onopen = () => {
        streamHealthyRef.current = true;
        lastStreamEventAtRef.current = Date.now();
      };

      source.onerror = (error) => {
        streamHealthyRef.current = false;
        console.warn("[chat:agent_stream_error]", error);
      };

      source.addEventListener("snapshot", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as {
          messages?: Message[];
          meta?: {
            visitorTyping?: boolean;
            agentTyping?: boolean;
            agentOnline?: boolean;
          };
        };

        setMessages(dedupeMessages(payload.messages ?? []));
        setVisitorTyping(Boolean(payload.meta?.visitorTyping));
        setAgentTyping(Boolean(payload.meta?.agentTyping));
        setAgentOnline(Boolean(payload.meta?.agentOnline));
        lastStreamEventAtRef.current = Date.now();
        streamHealthyRef.current = true;
      });
    };

    const connectSocket = () => {
      socketRef.current?.disconnect();
      socketHealthyRef.current = false;
      socketRef.current = connectConversationSocket({
        conversationId: activeId,
        onState: (state) => {
          socketHealthyRef.current = state === "connected";
        },
        onEvent: (event) => {
          if (event.conversationId === activeId) {
            void sync();
          }
        },
      });
    };

    connectSocket();
    connectStream();
    void sync();
    const interval = window.setInterval(() => {
      const streamStale = Date.now() - lastStreamEventAtRef.current > 20_000;
      if (!socketHealthyRef.current && (!streamHealthyRef.current || streamStale)) {
        // Fallback polling only when stream appears unhealthy.
        void sync();
      }
    }, 12_000);

    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
      socketHealthyRef.current = false;
      streamRef.current?.close();
      streamRef.current = null;
      streamHealthyRef.current = false;
      window.clearInterval(interval);
    };
  }, [activeId]);

  const publishTyping = useCallback(async (isTyping: boolean) => {
    if (!activeId) {
      return;
    }

    await fetch("/api/chat/typing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: activeId, isTyping }),
    }).catch((error: unknown) => {
      console.error("[chat:agent_typing_failed]", error);
    });

    lastTypingValueRef.current = isTyping;
  }, [activeId]);

  const scheduleTyping = (isTyping: boolean) => {
    if (typingDebounceRef.current) {
      window.clearTimeout(typingDebounceRef.current);
    }

    typingDebounceRef.current = window.setTimeout(() => {
      if (lastTypingValueRef.current !== isTyping) {
        void publishTyping(isTyping);
      }
    }, 500);
  };

  useEffect(() => {
    return () => {
      if (typingDebounceRef.current) {
        window.clearTimeout(typingDebounceRef.current);
      }
      if (lastTypingValueRef.current) {
        void publishTyping(false);
      }
    };
  }, [activeId, publishTyping]);

  const sendMessage = async () => {
    const trimmed = text.trim();
    if (!activeId || !trimmed || isSending) {
      return;
    }

    setIsSending(true);
    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, text: trimmed }),
      }).catch((error: unknown) => {
        console.error("[chat:agent_send_failed]", error);
        return null;
      });

      if (!response || !response.ok) {
        const payload = response ? ((await response.json().catch(() => null)) as { error?: string } | null) : null;
        console.warn("[chat:agent_send_bad_status]", response?.status, payload?.error);
        return;
      }

      setText("");
      await publishTyping(false);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className="min-h-screen px-6 py-8 sm:px-8 lg:px-10">
      <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[340px_1fr]">
        <aside className="card rounded-[2rem] p-5">
          <p className="eyebrow">Live Chat Inbox</p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">Website conversations</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            {agentOnline ? "Agents online" : "No active agent heartbeat"}
          </p>

          <div className="mt-5 grid gap-3">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                onClick={() => setActiveId(conversation.id)}
                className={`min-w-0 w-full rounded-2xl border px-4 py-3 text-left transition ${
                  conversation.id === activeId
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                    : "border-[var(--color-line)] bg-[rgba(255,255,255,0.65)]"
                }`}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <strong className="min-w-0 truncate text-sm">
                    {conversation.customerName || conversation.customerEmail || "Website visitor"}
                  </strong>
                  {conversation.unreadCount > 0 ? (
                    <span className="rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-xs font-bold text-white">
                      {conversation.unreadCount}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-xs text-[var(--color-muted)]">
                  {conversation.latestMessage?.body || conversation.subject}
                </p>
              </button>
            ))}
          </div>
        </aside>

        <section className="card rounded-[2rem] p-5">
          {activeConversation ? (
            <>
              <header className="border-b border-[var(--color-line)] pb-4">
                <p className="eyebrow">Conversation</p>
                <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">
                  {activeConversation.customerName || "Website visitor"}
                </h2>
                <p className="mt-1 text-sm text-[var(--color-muted)]">
                  {activeConversation.customerEmail || "No email shared"} · {activeConversation.visitorOnline ? "Online" : "Offline"}
                </p>
              </header>

              <div className="mt-4 grid max-h-[480px] gap-3 overflow-auto pr-2">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex items-end gap-2 ${message.senderType === "AGENT" ? "justify-end" : "justify-start"}`}
                  >
                    {message.senderType === "AGENT" ? null : (
                      <div className="h-7 w-7 shrink-0 rounded-full border border-[var(--color-line)] bg-[rgba(255,255,255,0.9)] text-center text-[10px] font-bold leading-7 text-[var(--color-soft)]">
                        {getInitials(activeConversation?.customerName || activeConversation?.customerEmail || "Visitor")}
                      </div>
                    )}

                    <div
                      className={`max-w-[76%] rounded-2xl border px-4 py-3 shadow-[0_6px_18px_rgba(42,37,31,0.06)] ${
                        message.senderType === "AGENT"
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                          : "border-[var(--color-line)] bg-[rgba(255,255,255,0.78)]"
                      }`}
                    >
                      <p
                        className={`text-xs font-semibold ${
                          message.senderType === "AGENT"
                            ? "text-[rgba(255,255,255,0.82)]"
                            : "text-[var(--color-soft)]"
                        }`}
                      >
                        {message.senderType === "AGENT"
                          ? message.senderUser?.fullName || "Cosmofeed Support"
                          : activeConversation?.customerName || "Website visitor"}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{message.body}</p>
                      {message.senderType === "AGENT" ? (
                        <small className={`status-meta ${message.readByVisitorAt ? "read" : "sent"}`}>
                          <span className="time-stamp">{formatMessageTime(message.createdAt)}</span>
                          <span className="tick-group" aria-label={message.readByVisitorAt ? "Read" : "Sent"}>
                            <span className="tick first">✓</span>
                            <span className="tick second">✓</span>
                          </span>
                          <span className="status-label">{message.readByVisitorAt ? "Read" : "Sent"}</span>
                        </small>
                      ) : (
                        <small className="status-meta visitor">
                          <span className="time-stamp visitor-time">{formatMessageTime(message.createdAt)}</span>
                        </small>
                      )}
                    </div>

                    {message.senderType === "AGENT" ? (
                      <div className="h-7 w-7 shrink-0 rounded-full border border-[rgba(230,47,137,0.3)] bg-[var(--color-accent-soft)] text-center text-[10px] font-bold leading-7 text-[var(--color-accent-strong)]">
                        {getInitials(message.senderUser?.fullName || "Cosmofeed Support")}
                      </div>
                    ) : null}
                  </div>
                ))}
                {visitorTyping ? (
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 shrink-0 rounded-full border border-[var(--color-line)] bg-[rgba(255,255,255,0.9)] text-center text-[10px] font-bold leading-7 text-[var(--color-soft)]">
                      {getInitials(activeConversation?.customerName || activeConversation?.customerEmail || "Visitor")}
                    </div>
                    <div className="typing-pill" aria-live="polite" aria-label="Visitor is typing">
                      <span className="typing-dot" />
                      <span className="typing-dot delay-1" />
                      <span className="typing-dot delay-2" />
                    </div>
                  </div>
                ) : null}
                {agentTyping ? (
                  <div className="flex justify-end">
                    <div className="typing-pill agent" aria-live="polite" aria-label="Another agent is typing">
                      <span className="typing-dot" />
                      <span className="typing-dot delay-1" />
                      <span className="typing-dot delay-2" />
                    </div>
                  </div>
                ) : null}
              </div>

              <style jsx>{`
                .status-meta {
                  display: inline-flex;
                  align-items: center;
                  justify-content: flex-end;
                  width: 100%;
                  gap: 4px;
                  margin-top: 6px;
                }
                .status-meta.visitor {
                  justify-content: flex-end;
                }
                .time-stamp {
                  font-size: 10px;
                  letter-spacing: 0.02em;
                  color: rgba(255, 255, 255, 0.82);
                }
                .visitor-time {
                  color: var(--color-muted);
                }
                .status-label {
                  font-size: 10px;
                  letter-spacing: 0.02em;
                  opacity: 0.9;
                }
                .tick-group {
                  display: inline-flex;
                  align-items: center;
                  line-height: 1;
                  transform-origin: center;
                }
                .tick {
                  font-size: 12px;
                  font-weight: 700;
                  display: inline-block;
                  transition: color 180ms ease, transform 180ms ease, opacity 180ms ease;
                }
                .tick.second {
                  margin-left: -3px;
                }
                .status-meta.sent .tick.first {
                  color: rgba(255, 255, 255, 0.82);
                  opacity: 1;
                }
                .status-meta.sent .tick.second {
                  opacity: 0;
                  width: 0;
                  overflow: hidden;
                  color: rgba(255, 255, 255, 0.82);
                }
                .status-meta.sent .status-label {
                  color: rgba(255, 255, 255, 0.86);
                }
                .status-meta.read .tick-group {
                  animation: tick-pop 280ms cubic-bezier(0.17, 0.84, 0.44, 1) both;
                }
                .status-meta.read .tick.first,
                .status-meta.read .tick.second {
                  color: #36a3ff;
                  opacity: 1;
                  width: auto;
                }
                .status-meta.read .status-label {
                  color: #36a3ff;
                  opacity: 1;
                }
                .typing-pill {
                  display: inline-flex;
                  align-items: center;
                  gap: 4px;
                  border: 1px solid var(--color-line);
                  border-radius: 999px;
                  background: rgba(255, 255, 255, 0.82);
                  padding: 9px 11px;
                  box-shadow: 0 6px 18px rgba(20, 22, 32, 0.06);
                }
                .typing-pill.agent {
                  border-color: rgba(230, 47, 137, 0.28);
                  background: var(--color-accent-soft);
                }
                .typing-dot {
                  width: 6px;
                  height: 6px;
                  border-radius: 999px;
                  background: #8c91a0;
                  display: inline-block;
                  animation: typing-pulse 1s infinite ease-in-out;
                }
                .typing-dot.delay-1 {
                  animation-delay: 0.15s;
                }
                .typing-dot.delay-2 {
                  animation-delay: 0.3s;
                }
                @keyframes tick-pop {
                  0% {
                    transform: scale(0.9) translateY(1px);
                    filter: drop-shadow(0 0 0 rgba(54, 163, 255, 0));
                  }
                  60% {
                    transform: scale(1.12) translateY(-1px);
                    filter: drop-shadow(0 0 8px rgba(54, 163, 255, 0.55));
                  }
                  100% {
                    transform: scale(1) translateY(0);
                    filter: drop-shadow(0 0 0 rgba(54, 163, 255, 0));
                  }
                }
                @keyframes typing-pulse {
                  0%,
                  80%,
                  100% {
                    transform: translateY(0);
                    opacity: 0.35;
                  }
                  40% {
                    transform: translateY(-2px);
                    opacity: 1;
                  }
                }
              `}</style>

              <footer className="mt-4 grid grid-cols-[1fr_auto] gap-3 border-t border-[var(--color-line)] pt-4">
                <textarea
                  className="input min-h-[80px]"
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    scheduleTyping(event.target.value.trim().length > 0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder="Reply to visitor"
                />
                <button className="btn-primary self-end" onClick={() => void sendMessage()} disabled={isSending || text.trim().length === 0}>
                  {isSending ? "Sending..." : "Send"}
                </button>
              </footer>
            </>
          ) : (
            <div className="flex h-full min-h-[420px] items-center justify-center text-[var(--color-muted)]">
              Waiting for first website conversation.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
