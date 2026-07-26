"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Socket } from "socket.io-client";

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

export function WidgetChatClient() {
  const searchParams = useSearchParams();
  const workspace = searchParams.get("workspace") ?? "";

  const storagePrefix = useMemo(() => `relaydesk.widget.${workspace}`, [workspace]);

  const [conversationId, setConversationId] = useState("");
  const [visitorToken, setVisitorToken] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [meta, setMeta] = useState<ChatMeta>({
    agentOnline: false,
    visitorOnline: true,
    visitorTyping: false,
    agentTyping: false,
  });
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<KbSuggestion[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [resolutionSubmitting, setResolutionSubmitting] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const typingDebounceRef = useRef<number | null>(null);
  const lastTypingValueRef = useRef(false);
  const streamRef = useRef<EventSource | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const socketHealthyRef = useRef(false);
  const streamHealthyRef = useRef(false);
  const lastStreamEventAtRef = useRef(0);

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

  const agentDisplayName = (message: Message) => message.senderUser?.fullName || "CCP Agent";

  if (!workspace) {
    return (
      <div className="widget-shell missing">
        <div className="empty-state">
          <div className="avatar brand">CCP</div>
          <strong>Workspace required</strong>
          <p>Open this widget with a workspace slug, or install it using the script tag from your dashboard.</p>
        </div>
        <style jsx>{`
          .widget-shell {
            min-height: 100%;
            display: grid;
            place-items: center;
            background: #fff8f1;
            font-family: system-ui, -apple-system, sans-serif;
            padding: 24px;
          }
          .empty-state {
            display: grid;
            gap: 10px;
            justify-items: center;
            max-width: 280px;
            text-align: center;
            color: #2c2118;
          }
          .empty-state p {
            margin: 0;
            color: #7d6b59;
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
            background: #b65a34;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="widget-shell">
      <header className="widget-head">
        <div className="title-wrap">
          <div className="avatar brand">CCP</div>
          <div>
            <strong>CCP Live Chat</strong>
            <p>
              <span className={`status-dot ${meta.agentOnline ? "online" : "offline"}`} />
              {meta.agentOnline ? "Agent online" : "We reply quickly"}
            </p>
            {ticketNumber ? <p className="ticket-line">Ticket {ticketNumber}</p> : null}
          </div>
        </div>
        <button onClick={() => window.parent.postMessage("relaydesk:close", "*")}>✕</button>
      </header>

      <div className="widget-feed">
        {messages.map((message) => (
          <div key={message.id} className={`row ${message.senderType === "VISITOR" ? "mine" : "other"}`}>
            {message.senderType === "VISITOR" ? null : (
              <div className="avatar small">{getInitials(agentDisplayName(message))}</div>
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

        {meta.agentTyping ? (
          <div className="row other">
            <div className="avatar small">CA</div>
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
          placeholder="Write a message"
          rows={2}
        />
        <button onClick={() => void sendMessage()} disabled={isSending || text.trim().length === 0}>
          Send
        </button>
      </footer>

      <style jsx>{`
        .widget-shell {
          height: 100%;
          display: grid;
          grid-template-rows: auto 1fr auto;
          background: #fff8f1;
          font-family: system-ui, -apple-system, sans-serif;
        }
        .widget-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid #e2d6c7;
          background: #fff;
        }
        .title-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
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
          background: #b65a34;
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
          font-size: 12px;
          color: #7d6b59;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .widget-head .ticket-line {
          color: #6a4a33;
          font-size: 11px;
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
          background: #b7a896;
        }
        .widget-head button {
          border: 0;
          background: transparent;
          cursor: pointer;
          font-size: 16px;
        }
        .widget-feed {
          padding: 12px;
          overflow: auto;
          display: grid;
          gap: 10px;
          align-content: start;
          background: linear-gradient(180deg, rgba(255, 248, 241, 0.35) 0%, rgba(255, 248, 241, 0.7) 100%);
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
          border: 1px solid #e8ddd0;
          border-radius: 14px 14px 14px 4px;
          padding: 8px 10px;
        }
        .bubble.mine {
          background: #b65a34;
          border-color: #b65a34;
          color: #fff;
          border-radius: 14px 14px 4px 14px;
        }
        .author {
          margin: 0 0 4px;
          font-size: 11px;
          font-weight: 700;
          color: #7d6b59;
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
          border: 1px solid #e3d1bd;
          border-radius: 999px;
          background: #fff;
          padding: 8px 10px;
        }
        .typing-pill span {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #b08f71;
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
          border: 1px solid #e8ddd0;
          border-radius: 16px;
          background: #fff;
          box-shadow: 0 10px 22px rgba(74, 52, 34, 0.08);
          color: #2c2118;
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
          background: #2a9d57;
        }
        .resolution-no {
          background: #2c2118;
        }
        .widget-compose {
          border-top: 1px solid #e2d6c7;
          background: #fff;
          padding: 10px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
        }
        .kb-suggestions {
          grid-column: 1 / -1;
          display: grid;
          gap: 6px;
          border: 1px solid #eadbcb;
          border-radius: 14px;
          background: #fffaf4;
          padding: 8px;
        }
        .kb-label {
          color: #7d6b59;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .kb-suggestion {
          border: 1px solid #eadbcb;
          border-radius: 12px;
          background: #fff;
          color: #2c2118;
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
          color: #7d6b59;
          font-size: 11px;
          line-height: 1.35;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        textarea {
          resize: none;
          border: 1px solid #d8c7b3;
          border-radius: 10px;
          padding: 8px;
          font: inherit;
          outline: none;
        }
        button {
          border: 0;
          border-radius: 999px;
          background: #b65a34;
          color: #fff;
          padding: 0 14px;
          font-weight: 700;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .widget-compose .kb-suggestion {
          border: 1px solid #eadbcb;
          border-radius: 12px;
          background: #fff;
          color: #2c2118;
          display: grid;
          gap: 2px;
          padding: 8px;
          text-align: left;
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
  );
}
