"use client";

import { useEffect, useMemo, useState } from "react";

type EmailConversation = {
  id: string;
  subject: string;
  customerName: string | null;
  customerEmail: string | null;
  status: "OPEN" | "SNOOZED" | "RESOLVED";
  updatedAt: string;
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

export function AgentEmailClient() {
  const [conversations, setConversations] = useState<EmailConversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );

  useEffect(() => {
    const load = async () => {
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
    };

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 8_000);

    return () => window.clearInterval(interval);
  }, [activeId]);

  useEffect(() => {
    if (!activeId) {
      return;
    }

    const loadMessages = async () => {
      const response = await fetch(`/api/email/messages?conversationId=${activeId}`, {
        cache: "no-store",
      }).catch(() => null);
      if (!response || !response.ok) {
        return;
      }

      const payload = await response.json();
      setMessages(payload.messages ?? []);
    };

    void loadMessages();
    const interval = window.setInterval(() => {
      void loadMessages();
    }, 8_000);

    return () => window.clearInterval(interval);
  }, [activeId]);

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

      const refreshResponse = await fetch(`/api/email/messages?conversationId=${activeId}`, {
        cache: "no-store",
      });
      if (refreshResponse.ok) {
        const payload = await refreshResponse.json();
        setMessages(payload.messages ?? []);
      }
    } catch (error) {
      console.error("[email:reply_failed]", error);
    } finally {
      setIsSending(false);
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
              </button>
            ))}
          </div>
        </aside>

        <section className="card rounded-[2rem] p-5">
          {activeConversation ? (
            <>
              <header className="border-b border-[var(--color-line)] pb-4">
                <p className="eyebrow">Thread</p>
                <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">{activeConversation.subject}</h2>
                <p className="mt-1 text-sm text-[var(--color-muted)]">
                  {activeConversation.customerName || "Customer"} · {activeConversation.customerEmail || "No email"}
                </p>
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
                    <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                  </div>
                ))}
              </div>

              <footer className="mt-4 grid grid-cols-[1fr_auto] gap-3 border-t border-[var(--color-line)] pt-4">
                <textarea
                  className="input min-h-[100px]"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="Reply to customer email"
                />
                <button
                  className="btn-primary self-end"
                  onClick={() => void sendReply()}
                  disabled={isSending || text.trim().length === 0}
                >
                  {isSending ? "Sending..." : "Send reply"}
                </button>
              </footer>
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
