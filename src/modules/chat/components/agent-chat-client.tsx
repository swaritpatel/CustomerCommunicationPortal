"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const [agentTyping, setAgentTyping] = useState(false);
  const [visitorTyping, setVisitorTyping] = useState(false);
  const [agentOnline, setAgentOnline] = useState(false);
  const typingDebounceRef = useRef<number | null>(null);
  const lastTypingValueRef = useRef(false);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );

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

    let source: EventSource | null = null;

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
      setMessages(payload.messages ?? []);
      setVisitorTyping(Boolean(payload.meta?.visitorTyping));
      setAgentTyping(Boolean(payload.meta?.agentTyping));
      setAgentOnline(Boolean(payload.meta?.agentOnline));
    };

    const connectStream = () => {
      source = new EventSource(`/api/chat/stream?conversationId=${encodeURIComponent(activeId)}`);

      source.onerror = (error) => {
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

        setMessages(payload.messages ?? []);
        setVisitorTyping(Boolean(payload.meta?.visitorTyping));
        setAgentTyping(Boolean(payload.meta?.agentTyping));
        setAgentOnline(Boolean(payload.meta?.agentOnline));
      });
    };

    connectStream();
    void sync();
    const interval = window.setInterval(() => {
      // Slow polling fallback keeps chat healthy if SSE reconnects are delayed.
      void sync();
    }, 12_000);

    return () => {
      source?.close();
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
    if (!activeId || !trimmed) {
      return;
    }

    await fetch("/api/chat/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: activeId, text: trimmed }),
    }).catch((error: unknown) => {
      console.error("[chat:agent_send_failed]", error);
      return null;
    });

    setText("");
    await publishTyping(false);
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
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  conversation.id === activeId
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                    : "border-[var(--color-line)] bg-[rgba(255,255,255,0.65)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-sm">
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
                      className={`max-w-[84%] rounded-2xl border px-4 py-3 ${
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
                          ? message.senderUser?.fullName || "CCP Agent"
                          : activeConversation?.customerName || "Website visitor"}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{message.body}</p>
                      {message.senderType === "AGENT" ? (
                        <p
                          className={`mt-1 text-right text-xs ${
                            message.readByVisitorAt
                              ? "text-[#36a3ff] font-semibold transition-colors duration-200"
                              : "text-[rgba(255,255,255,0.78)]"
                          }`}
                        >
                          ✓✓
                        </p>
                      ) : null}
                    </div>

                    {message.senderType === "AGENT" ? (
                      <div className="h-7 w-7 shrink-0 rounded-full border border-[rgba(182,90,52,0.3)] bg-[var(--color-accent-soft)] text-center text-[10px] font-bold leading-7 text-[var(--color-accent-strong)]">
                        {getInitials(message.senderUser?.fullName || "CCP Agent")}
                      </div>
                    ) : null}
                  </div>
                ))}
                {visitorTyping ? <p className="text-xs text-[var(--color-muted)]">Visitor is typing...</p> : null}
                {agentTyping ? <p className="text-xs text-[var(--color-muted)]">Another agent is typing...</p> : null}
              </div>

              <footer className="mt-4 grid grid-cols-[1fr_auto] gap-3 border-t border-[var(--color-line)] pt-4">
                <textarea
                  className="input min-h-[80px]"
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    scheduleTyping(event.target.value.trim().length > 0);
                  }}
                  placeholder="Reply to visitor"
                />
                <button className="btn-primary self-end" onClick={() => void sendMessage()}>
                  Send
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
