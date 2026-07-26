"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import type { Socket } from "socket.io-client";
import { Check, ChevronRight, Send, Sparkles, X } from "lucide-react";

import { connectConversationSocket } from "@/modules/realtime/client";

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

type ChatMeta = {
  agentOnline: boolean;
  visitorOnline: boolean;
  visitorTyping: boolean;
  agentTyping: boolean;
  ticketNumber?: string | null;
};

type KbSuggestion = {
  id: string;
  title: string;
  excerpt: string | null;
  href: string;
};

const quickPrompts = [
  "I need help with my account",
  "I have a billing question",
  "Talk to your support team",
];

function AgentAvatar({
  compact = false,
  variant = "female",
}: {
  compact?: boolean;
  variant?: "male" | "female";
}) {
  return (
    <>
      <span className={`agent-avatar ${compact ? "compact" : ""}`} aria-hidden="true">
        <span className="agent-avatar-core">
          <Image
            src={`/brand/cosmofeed-support-${variant}.png`}
            alt=""
            width={compact ? 30 : 48}
            height={compact ? 30 : 48}
            priority={!compact}
          />
        </span>
        <span className="agent-avatar-ring" />
        <span className="agent-avatar-spark"><Sparkles size={compact ? 7 : 9} /></span>
      </span>
      <style jsx>{`
        .agent-avatar {
          position: relative;
          display: inline-grid;
          width: 48px;
          height: 48px;
          flex: 0 0 48px;
          place-items: center;
        }
        .agent-avatar.compact {
          width: 28px;
          height: 28px;
          flex-basis: 28px;
        }
        .agent-avatar-core {
          position: relative;
          z-index: 2;
          display: grid;
          width: 40px;
          height: 40px;
          place-items: center;
          border: 2px solid rgba(255, 255, 255, 0.88);
          border-radius: 50%;
          overflow: hidden;
          background: #171923;
          box-shadow: 0 7px 22px rgba(10, 12, 20, 0.2);
          animation: agent-float 3.2s ease-in-out infinite;
        }
        .compact .agent-avatar-core {
          width: 27px;
          height: 27px;
          border-width: 1px;
          box-shadow: 0 4px 12px rgba(10, 12, 20, 0.16);
        }
        .agent-avatar-core :global(img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .agent-avatar-ring {
          position: absolute;
          inset: 0;
          border: 1px solid rgba(117, 89, 224, 0.48);
          border-radius: 50%;
          animation: avatar-pulse 2.4s ease-out infinite;
        }
        .compact .agent-avatar-ring {
          inset: -2px;
        }
        .agent-avatar-spark {
          position: absolute;
          z-index: 3;
          top: 0;
          right: 0;
          display: grid;
          width: 17px;
          height: 17px;
          place-items: center;
          border: 2px solid #181b25;
          border-radius: 50%;
          background: #e62f89;
          color: #ffffff;
        }
        .compact .agent-avatar-spark {
          top: -3px;
          right: -3px;
          width: 13px;
          height: 13px;
          border-width: 1px;
        }
        @keyframes agent-float {
          0%, 100% { transform: translateY(0) rotate(-2deg); }
          50% { transform: translateY(-3px) rotate(2deg); }
        }
        @keyframes avatar-pulse {
          0% { opacity: 0.65; transform: scale(0.84); }
          70%, 100% { opacity: 0; transform: scale(1.16); }
        }
        @media (prefers-reduced-motion: reduce) {
          .agent-avatar-core,
          .agent-avatar-ring {
            animation: none;
          }
        }
      `}</style>
    </>
  );
}

export function WidgetChatClient({ previewMode = false }: { previewMode?: boolean }) {
  const searchParams = useSearchParams();
  const workspace = searchParams.get("workspace") ?? "";

  const storagePrefix = useMemo(() => `relaydesk.widget.${workspace}`, [workspace]);

  const [conversationId, setConversationId] = useState("");
  const [visitorToken, setVisitorToken] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentVariant, setAgentVariant] = useState<"male" | "female">("female");
  const [meta, setMeta] = useState<ChatMeta>({
    agentOnline: false,
    visitorOnline: true,
    visitorTyping: false,
    agentTyping: false,
  });
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<KbSuggestion[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [localAgentTyping, setLocalAgentTyping] = useState(false);
  const [resolutionSubmitting, setResolutionSubmitting] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const typingDebounceRef = useRef<number | null>(null);
  const autoTypingTimerRef = useRef<number | null>(null);
  const lastTypingValueRef = useRef(false);
  const streamRef = useRef<EventSource | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const socketHealthyRef = useRef(false);
  const streamHealthyRef = useRef(false);
  const lastStreamEventAtRef = useRef(0);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    const variantKey = `${storagePrefix}.agentVariant`;
    const savedVariant = window.localStorage.getItem(variantKey);
    if (savedVariant === "male" || savedVariant === "female") {
      queueMicrotask(() => setAgentVariant(savedVariant));
      return;
    }

    const nextVariant = Math.random() >= 0.5 ? "female" : "male";
    window.localStorage.setItem(variantKey, nextVariant);
    queueMicrotask(() => setAgentVariant(nextVariant));
  }, [storagePrefix, workspace]);

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

  useEffect(() => {
    if (!workspace) {
      return;
    }

    const cacheConversationId = window.localStorage.getItem(`${storagePrefix}.conversationId`) ?? "";
    const cacheVisitorToken = window.localStorage.getItem(`${storagePrefix}.visitorToken`) ?? "";
    const cacheTicketNumber = window.localStorage.getItem(`${storagePrefix}.ticketNumber`) ?? "";
    const savedCustomerKey = window.localStorage.getItem(`${storagePrefix}.customerKey`) ?? "";

    if (cacheConversationId && cacheVisitorToken) {
      queueMicrotask(() => {
        setConversationId(cacheConversationId);
        setVisitorToken(cacheVisitorToken);
        setTicketNumber(cacheTicketNumber);
      });
      return;
    }

    void fetch("/api/chat/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceSlug: workspace,
        customerKey: savedCustomerKey || undefined,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to initialize chat");
        }
        return response.json();
      })
      .then((payload) => {
        setConversationId(payload.conversationId);
        setVisitorToken(payload.visitorToken);
        setTicketNumber(payload.ticketNumber ?? "");
        setMessages(dedupeMessages(payload.messages ?? []));
        setMeta((previous) => ({ ...previous, agentOnline: Boolean(payload.agentOnline) }));
        window.localStorage.setItem(`${storagePrefix}.conversationId`, payload.conversationId);
        window.localStorage.setItem(`${storagePrefix}.customerKey`, payload.customerKey);
        window.localStorage.setItem(`${storagePrefix}.visitorToken`, payload.visitorToken);
        if (payload.ticketNumber) {
          window.localStorage.setItem(`${storagePrefix}.ticketNumber`, payload.ticketNumber);
        }
      })
      .catch((error: unknown) => {
        console.error(error);
      });
  }, [workspace, storagePrefix, bootstrapAttempt]);

  useEffect(() => {
    const query = text.trim();
    if (!workspace || query.length < 3) {
      const timeout = window.setTimeout(() => setSuggestions([]), 0);
      return () => window.clearTimeout(timeout);
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void fetch(`/api/kb/suggest?workspace=${encodeURIComponent(workspace)}&q=${encodeURIComponent(query)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            return { suggestions: [] };
          }
          return response.json();
        })
        .then((payload) => {
          setSuggestions((payload.suggestions ?? []) as KbSuggestion[]);
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name !== "AbortError") {
            console.error("[chat:kb_suggest_failed]", error);
          }
        });
    }, 260);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [workspace, text]);

  useEffect(() => {
    if (!conversationId || !visitorToken) {
      return;
    }

    const sync = async () => {
      const response = await fetch(`/api/chat/messages?conversationId=${conversationId}`, {
        headers: { authorization: `Bearer ${visitorToken}` },
        cache: "no-store",
      }).catch((error: unknown) => {
        console.error("[chat:widget_sync_failed]", error);
        return null;
      });

      if (!response || !response.ok) {
        if (response && !response.ok) {
          console.warn("[chat:widget_sync_bad_status]", response.status);
          if (response.status === 401 || response.status === 403) {
            window.localStorage.removeItem(`${storagePrefix}.conversationId`);
            window.localStorage.removeItem(`${storagePrefix}.visitorToken`);
            window.localStorage.removeItem(`${storagePrefix}.ticketNumber`);
            setConversationId("");
            setVisitorToken("");
            setTicketNumber("");
            setMessages([]);
            setBootstrapAttempt((current) => current + 1);
          }
        }
        return;
      }

      const payload = await response.json();
      setMessages(dedupeMessages(payload.messages ?? []));
      setMeta((previous) => payload.meta ?? previous);
      if (payload.meta?.ticketNumber) {
        setTicketNumber(payload.meta.ticketNumber);
        window.localStorage.setItem(`${storagePrefix}.ticketNumber`, payload.meta.ticketNumber);
      }
    };

    const connectStream = () => {
      streamRef.current?.close();
      const source = new EventSource(
        `/api/chat/stream?conversationId=${encodeURIComponent(conversationId)}&token=${encodeURIComponent(visitorToken)}`,
      );
      streamRef.current = source;

      source.onopen = () => {
        streamHealthyRef.current = true;
        lastStreamEventAtRef.current = Date.now();
      };

      source.onerror = (error) => {
        streamHealthyRef.current = false;
        console.warn("[chat:widget_stream_error]", error);
      };

      source.addEventListener("snapshot", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as {
          messages?: Message[];
          meta?: ChatMeta;
        };
        lastStreamEventAtRef.current = Date.now();
        streamHealthyRef.current = true;
        setMessages(dedupeMessages(payload.messages ?? []));
        setMeta((previous) => payload.meta ?? previous);
      });
    };

    const connectSocket = () => {
      socketRef.current?.disconnect();
      socketHealthyRef.current = false;
      socketRef.current = connectConversationSocket({
        conversationId,
        onState: (state) => {
          socketHealthyRef.current = state === "connected";
        },
        onEvent: (event) => {
          if (event.conversationId === conversationId) {
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
  }, [conversationId, visitorToken, storagePrefix]);

  const sendTyping = useCallback(async (isTyping: boolean) => {
    if (!conversationId || !visitorToken) {
      return;
    }

    await fetch("/api/chat/typing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${visitorToken}`,
      },
      body: JSON.stringify({ conversationId, isTyping }),
    }).catch((error: unknown) => {
      console.error("[chat:widget_typing_failed]", error);
    });

    lastTypingValueRef.current = isTyping;
  }, [conversationId, visitorToken]);

  const scheduleTyping = (isTyping: boolean) => {
    if (typingDebounceRef.current) {
      window.clearTimeout(typingDebounceRef.current);
    }

    typingDebounceRef.current = window.setTimeout(() => {
      if (lastTypingValueRef.current !== isTyping) {
        void sendTyping(isTyping);
      }
    }, 500);
  };

  useEffect(() => {
    return () => {
      if (typingDebounceRef.current) {
        window.clearTimeout(typingDebounceRef.current);
      }
      if (autoTypingTimerRef.current) {
        window.clearTimeout(autoTypingTimerRef.current);
      }
      if (lastTypingValueRef.current) {
        void sendTyping(false);
      }
    };
  }, [conversationId, visitorToken, sendTyping]);

  const sendMessage = async () => {
    const trimmed = text.trim();
    if (!trimmed || !conversationId || !visitorToken || isSending) {
      return;
    }

    setIsSending(true);
    setLocalAgentTyping(true);
    if (autoTypingTimerRef.current) {
      window.clearTimeout(autoTypingTimerRef.current);
    }
    autoTypingTimerRef.current = window.setTimeout(() => {
      setLocalAgentTyping(false);
      autoTypingTimerRef.current = null;
    }, 1_000);

    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${visitorToken}`,
        },
        body: JSON.stringify({ conversationId, text: trimmed }),
      }).catch((error: unknown) => {
        console.error("[chat:widget_send_failed]", error);
        return null;
      });

      if (!response || !response.ok) {
        const payload = response ? ((await response.json().catch(() => null)) as { error?: string } | null) : null;
        console.warn("[chat:widget_send_bad_status]", response?.status, payload?.error);
        return;
      }

      setText("");
      setSuggestions([]);
      await sendTyping(false);
    } finally {
      setIsSending(false);
    }
  };

  const isClarifyingSupportMessage = (message: Message | undefined) => {
    if (!message || message.senderType === "VISITOR") {
      return true;
    }

    const normalized = message.body.trim().toLowerCase();

    if (normalized.length < 40) {
      return true;
    }

    if (
      /^(hi|hii+|hello|hey|ok|okay|sure|thanks|thank you|yes|no)[\s!.,-]*(sir|there|team)?[\s!.,-]*$/i.test(
        message.body.trim(),
      )
    ) {
      return true;
    }

    return [
      "how can i assist",
      "how can i help",
      "what can i help",
      "feel free to ask",
      "please share",
      "please provide",
      "could you share",
      "can you share",
      "tell me more",
      "more details",
      "additional details",
    ].some((phrase) => normalized.includes(phrase));
  };

  const hasSubstantiveVisitorIssue = () => {
    const latestSupportIndex = messages.findLastIndex((message) => message.senderType !== "VISITOR");
    const visitorMessages = messages.filter((message, index) => {
      if (message.senderType !== "VISITOR") {
        return false;
      }

      return latestSupportIndex === -1 || index < latestSupportIndex;
    });

    return visitorMessages.some((message) => {
      const normalized = message.body.trim().toLowerCase();
      return (
        normalized.length >= 18 ||
        /\b(refund|cancel|cancelled|canceled|order|payment|delivery|delivered|login|account|error|issue|problem|not received|failed|broken|help)\b/.test(
          normalized,
        )
      );
    });
  };

  const lastMessage = messages.at(-1);
  const showResolutionPrompt =
    Boolean(conversationId && visitorToken) &&
    !meta.agentTyping &&
    Boolean(lastMessage) &&
    lastMessage?.senderType !== "VISITOR" &&
    !isClarifyingSupportMessage(lastMessage) &&
    hasSubstantiveVisitorIssue();

  const sendResolutionFeedback = async (resolved: boolean) => {
    if (!conversationId || !visitorToken || resolutionSubmitting) {
      return;
    }

    setResolutionSubmitting(true);

    try {
      const response = await fetch("/api/chat/resolution", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${visitorToken}`,
        },
        body: JSON.stringify({ conversationId, resolved }),
      }).catch((error: unknown) => {
        console.error("[chat:widget_resolution_failed]", error);
        return null;
      });

      if (!response || !response.ok) {
        const payload = response ? ((await response.json().catch(() => null)) as { error?: string } | null) : null;
        console.warn("[chat:widget_resolution_bad_status]", response?.status, payload?.error);
        return;
      }

      const payload = (await response.json()) as { message?: Message };
      if (payload.message) {
        setMessages((current) => dedupeMessages([...current, payload.message as Message]));
      }
    } finally {
      setResolutionSubmitting(false);
    }
  };

  const agentDisplayName = (message: Message) => message.senderUser?.fullName || "Cosmofeed Support";
  const closeWidget = () => {
    if (window.parent !== window) {
      window.parent.postMessage("relaydesk:close", "*");
      return;
    }

    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.location.assign("/");
  };

  if (!workspace) {
    return (
      <div className="widget-shell missing">
        <div className="empty-state">
          <AgentAvatar variant={agentVariant} />
          <strong>Workspace required</strong>
          <p>Open this widget with a workspace slug, or install it using the script tag from your dashboard.</p>
        </div>
        <style jsx>{`
          .widget-shell {
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #f4f5f8;
            font-family: system-ui, -apple-system, sans-serif;
            padding: 24px;
          }
          .empty-state {
            display: grid;
            gap: 10px;
            justify-items: center;
            max-width: 280px;
            text-align: center;
            color: #171923;
          }
          .empty-state p {
            margin: 0;
            color: #707584;
            font-size: 13px;
            line-height: 1.5;
          }
          .avatar {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            font-weight: 800;
            letter-spacing: 0.04em;
          }
          .avatar.brand {
            width: 44px;
            height: 44px;
            font-size: 12px;
            color: #fff;
            background: #e62f89;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className={previewMode ? "widget-preview-stage" : "widget-embed-stage"}>
    <div className="widget-shell">
      <header className="widget-head">
        <div className="title-wrap">
          <AgentAvatar variant={agentVariant} />
          <div>
            <span className="agent-kicker">Cosmofeed support</span>
            <strong>How can we help?</strong>
            <p>
              <span className={`status-dot ${meta.agentOnline ? "online" : "offline"}`} />
              {meta.agentOnline ? "Team online now" : "AI answers instantly"}
            </p>
            {ticketNumber ? <p className="ticket-line">Ticket {ticketNumber}</p> : null}
          </div>
        </div>
        <button
          className="close-button"
          aria-label="Close chat"
          title="Close chat"
          onClick={closeWidget}
        >
          <X size={18} />
        </button>
      </header>

      <div className="widget-feed">
        {messages.length === 0 ? (
          <section className="welcome-state">
            <AgentAvatar variant={agentVariant} />
            <span className="welcome-kicker"><Sparkles size={12} /> AI support agent</span>
            <h1>Hey there, what can we solve together?</h1>
            <p>Ask a question or choose a quick starting point. A human can join whenever you need one.</p>
            <div className="quick-prompts">
              {quickPrompts.map((prompt) => (
                <button key={prompt} type="button" onClick={() => setText(prompt)}>
                  <span>{prompt}</span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
            <div className="trust-row">
              <span><Check size={12} /> Private</span>
              <span><Check size={12} /> Fast replies</span>
              <span><Check size={12} /> Human handoff</span>
            </div>
          </section>
        ) : null}

        {messages.map((message) => (
          <div key={message.id} className={`row ${message.senderType === "VISITOR" ? "mine" : "other"}`}>
            {message.senderType === "VISITOR" ? null : (
              <AgentAvatar compact variant={agentVariant} />
            )}
            <div className={message.senderType === "VISITOR" ? "bubble mine" : "bubble"}>
              <p className="author">{message.senderType === "VISITOR" ? "You" : agentDisplayName(message)}</p>
              <p>{message.body}</p>
              {message.senderType === "VISITOR" ? (
                <small className={`status-meta ${message.readByAgentAt ? "read" : "sent"}`}>
                  <span className="tick-group" aria-label={message.readByAgentAt ? "Read" : "Sent"}>
                    <span className="tick first">✓</span>
                    <span className="tick second">✓</span>
                  </span>
                  <span className="status-label">{message.readByAgentAt ? "Read" : "Sent"}</span>
                </small>
              ) : null}
            </div>
          </div>
        ))}

        {meta.agentTyping || localAgentTyping ? (
          <div className="row other">
            <AgentAvatar compact variant={agentVariant} />
            <div className="typing-pill" aria-live="polite" aria-label="Agent is typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : null}

        {showResolutionPrompt ? (
          <div className="resolution-card" aria-live="polite">
            <strong>Did this resolve your issue?</strong>
            <div className="resolution-actions">
              <button
                type="button"
                className="resolution-yes"
                disabled={resolutionSubmitting}
                onClick={() => void sendResolutionFeedback(true)}
              >
                Yes
              </button>
              <button
                type="button"
                className="resolution-no"
                disabled={resolutionSubmitting}
                onClick={() => void sendResolutionFeedback(false)}
              >
                No, keep open
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="widget-compose">
        {suggestions.length > 0 ? (
          <div className="kb-suggestions" aria-label="Suggested help articles">
            <span className="kb-label">Suggested articles</span>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                className="kb-suggestion"
                type="button"
                onClick={() => {
                  const href = `${window.location.origin}${suggestion.href}`;
                  window.open(href, "_blank", "noopener,noreferrer");
                }}
              >
                <strong>{suggestion.title}</strong>
                {suggestion.excerpt ? <span>{suggestion.excerpt}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
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
          placeholder="Ask us anything..."
          rows={2}
        />
        <button
          className="send-button"
          aria-label="Send message"
          title="Send message"
          onClick={() => void sendMessage()}
          disabled={isSending || text.trim().length === 0}
        >
          <Send size={17} />
        </button>
        <p className="composer-note">Press Enter to send · Shift + Enter for a new line</p>
      </footer>

      <style jsx>{`
        .widget-embed-stage {
          width: 100%;
          height: 100dvh;
        }
        .widget-preview-stage {
          min-height: 100dvh;
          display: grid;
          place-items: center;
          background: #11131b;
          padding: 28px 16px;
        }
        .widget-preview-stage .widget-shell {
          width: min(392px, 100%);
          height: min(640px, calc(100dvh - 56px));
          min-height: 520px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          box-shadow: 0 28px 80px rgba(0, 0, 0, 0.38);
        }
        .widget-shell {
          height: 100dvh;
          min-height: 100vh;
          display: grid;
          grid-template-rows: auto 1fr auto;
          background: #f4f5f8;
          color: #171923;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
        }
        .widget-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 88px;
          padding: 15px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          background: #171923;
          color: #fff;
        }
        .title-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .avatar {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          font-weight: 800;
          letter-spacing: 0.04em;
        }
        .avatar.brand {
          width: 34px;
          height: 34px;
          font-size: 11px;
          color: #fff;
          background: #e62f89;
        }
        .avatar.small {
          width: 24px;
          height: 24px;
          flex: 0 0 24px;
          font-size: 10px;
          color: #6a4a33;
          background: #f2e4d4;
          border: 1px solid #e3d1bd;
        }
        .widget-head p {
          margin: 2px 0 0;
          font-size: 11px;
          color: #aeb2c0;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .widget-head .ticket-line {
          color: #858b9d;
          font-size: 10px;
          font-weight: 700;
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          display: inline-block;
        }
        .status-dot.online {
          background: #2a9d57;
        }
        .status-dot.offline {
          background: #9ba1b1;
        }
        .widget-feed {
          padding: 16px 14px;
          overflow: auto;
          display: grid;
          gap: 12px;
          align-content: start;
          background: #f4f5f8;
        }
        .row {
          display: flex;
          gap: 8px;
          align-items: flex-end;
          max-width: 100%;
        }
        .row.mine {
          justify-content: flex-end;
        }
        .bubble {
          max-width: 82%;
          background: #ffffff;
          border: 1px solid #e1e3e9;
          border-radius: 8px 8px 8px 3px;
          padding: 10px 12px;
          box-shadow: 0 5px 16px rgba(20, 22, 32, 0.05);
        }
        .bubble.mine {
          background: #e62f89;
          border-color: #e62f89;
          color: #fff;
          border-radius: 8px 8px 3px 8px;
        }
        .author {
          margin: 0 0 4px;
          font-size: 11px;
          font-weight: 700;
          color: #777c8b;
        }
        .bubble.mine .author {
          color: rgba(255, 255, 255, 0.86);
        }
        .bubble p {
          margin: 0;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          line-height: 1.35;
        }
        .bubble small {
          display: block;
          margin-top: 6px;
          font-size: 11px;
          opacity: 0.9;
        }
        .status-meta {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          justify-content: flex-end;
          width: 100%;
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
        .status-meta.sent .tick-group {
          transform: translateY(0);
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
        .ticks {
          text-align: right;
        }
        .typing-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border: 1px solid #e1e3e9;
          border-radius: 999px;
          background: #fff;
          padding: 8px 10px;
        }
        .typing-pill span {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #8c91a0;
          animation: pulse 1s infinite ease-in-out;
        }
        .typing-pill span:nth-child(2) {
          animation-delay: 0.15s;
        }
        .typing-pill span:nth-child(3) {
          animation-delay: 0.3s;
        }
        .resolution-card {
          justify-self: center;
          width: min(100%, 320px);
          border: 1px solid #e1e3e9;
          border-radius: 8px;
          background: #fff;
          box-shadow: 0 10px 24px rgba(20, 22, 32, 0.08);
          color: #171923;
          display: grid;
          gap: 10px;
          padding: 12px;
          text-align: center;
        }
        .resolution-card strong {
          font-size: 13px;
        }
        .resolution-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .resolution-actions button {
          min-height: 36px;
          padding: 0 10px;
          font-size: 12px;
        }
        .resolution-yes {
          background: #14966d;
        }
        .resolution-no {
          background: #171923;
        }
        .widget-compose {
          border-top: 1px solid #e1e3e9;
          background: #fff;
          padding: 11px 12px 9px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 42px;
          gap: 8px;
        }
        .kb-suggestions {
          grid-column: 1 / -1;
          display: grid;
          gap: 6px;
          border: 1px solid #e1e3e9;
          border-radius: 8px;
          background: #f7f8fb;
          padding: 8px;
        }
        .kb-label {
          color: #777c8b;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .kb-suggestion {
          border: 1px solid #e1e3e9;
          border-radius: 7px;
          background: #fff;
          color: #171923;
          cursor: pointer;
          display: grid;
          gap: 2px;
          padding: 8px;
          text-align: left;
        }
        .kb-suggestion strong {
          font-size: 12px;
        }
        .kb-suggestion span {
          color: #777c8b;
          font-size: 11px;
          line-height: 1.35;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        textarea {
          resize: none;
          min-height: 46px;
          max-height: 110px;
          border: 1px solid #d9dce4;
          border-radius: 8px;
          background: #f8f9fb;
          color: #171923;
          padding: 11px 12px;
          font: inherit;
          outline: none;
          transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
        }
        textarea:focus {
          border-color: rgba(230, 47, 137, 0.48);
          background: #fff;
          box-shadow: 0 0 0 3px rgba(230, 47, 137, 0.1);
        }
        button {
          border: 0;
          border-radius: 7px;
          background: #e62f89;
          color: #fff;
          padding: 0 14px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
        }
        button:hover:not(:disabled) {
          transform: translateY(-1px);
        }
        button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .widget-compose .kb-suggestion {
          border: 1px solid #e1e3e9;
          border-radius: 7px;
          background: #fff;
          color: #171923;
          display: grid;
          gap: 2px;
          padding: 8px;
          text-align: left;
        }
        .agent-kicker {
          display: block;
          margin-bottom: 2px;
          color: #858b9d;
          font-size: 9px;
          font-weight: 850;
          letter-spacing: 0;
          text-transform: uppercase;
        }
        .close-button {
          display: grid;
          width: 34px;
          height: 34px;
          flex: 0 0 34px;
          place-items: center;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.06);
          color: #d8dae2;
          padding: 0;
        }
        .close-button:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.12);
          box-shadow: none;
        }
        .welcome-state {
          display: grid;
          justify-items: start;
          gap: 0;
          border: 1px solid #e1e3e9;
          border-radius: 8px;
          background: #fff;
          box-shadow: 0 12px 32px rgba(20, 22, 32, 0.07);
          padding: 18px 16px 14px;
          animation: welcome-arrive 440ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
        }
        .welcome-kicker {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          margin-top: 12px;
          color: #b71767;
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0;
          text-transform: uppercase;
        }
        .welcome-state h1 {
          max-width: 285px;
          margin: 6px 0 0;
          font-size: 22px;
          line-height: 1.15;
          letter-spacing: 0;
        }
        .welcome-state > p {
          margin: 9px 0 0;
          color: #666b79;
          font-size: 12px;
          line-height: 1.55;
        }
        .quick-prompts {
          display: grid;
          width: 100%;
          gap: 6px;
          margin-top: 15px;
        }
        .quick-prompts button {
          display: flex;
          min-height: 39px;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          border: 1px solid #e1e3e9;
          background: #f7f8fa;
          color: #262936;
          padding: 8px 10px;
          text-align: left;
        }
        .quick-prompts button:hover:not(:disabled) {
          border-color: rgba(230, 47, 137, 0.3);
          background: #fff5fa;
          color: #b71767;
          box-shadow: 0 6px 16px rgba(20, 22, 32, 0.05);
        }
        .quick-prompts button span {
          overflow: hidden;
          font-size: 11px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .trust-row {
          display: flex;
          width: 100%;
          flex-wrap: wrap;
          gap: 7px 12px;
          margin-top: 13px;
          color: #7d8290;
          font-size: 9px;
          font-weight: 700;
        }
        .trust-row span {
          display: inline-flex;
          align-items: center;
          gap: 3px;
        }
        .trust-row svg {
          color: #14966d;
        }
        .send-button {
          display: grid;
          width: 42px;
          height: 42px;
          align-self: end;
          place-items: center;
          background: #e62f89;
          padding: 0;
          box-shadow: 0 8px 20px rgba(230, 47, 137, 0.22);
        }
        .send-button:hover:not(:disabled) {
          background: #cd2477;
          box-shadow: 0 10px 24px rgba(230, 47, 137, 0.3);
        }
        .composer-note {
          grid-column: 1 / -1;
          margin: -1px 2px 0;
          color: #969aa7;
          font-size: 9px;
          line-height: 1.2;
        }
        @keyframes welcome-arrive {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes pulse {
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
      `}</style>
    </div>
    </div>
  );
}
