"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

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
};

export function WidgetChatClient() {
  const searchParams = useSearchParams();
  const workspace = searchParams.get("workspace") ?? "";

  const storagePrefix = useMemo(() => `relaydesk.widget.${workspace}`, [workspace]);

  const [conversationId, setConversationId] = useState("");
  const [visitorToken, setVisitorToken] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [meta, setMeta] = useState<ChatMeta>({
    agentOnline: false,
    visitorOnline: true,
    visitorTyping: false,
    agentTyping: false,
  });
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const typingDebounceRef = useRef<number | null>(null);
  const lastTypingValueRef = useRef(false);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    const savedCustomerKey = window.localStorage.getItem(`${storagePrefix}.customerKey`) ?? "";

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
        setMessages(payload.messages ?? []);
        setMeta((previous) => ({ ...previous, agentOnline: Boolean(payload.agentOnline) }));
        window.localStorage.setItem(`${storagePrefix}.customerKey`, payload.customerKey);
        window.localStorage.setItem(`${storagePrefix}.visitorToken`, payload.visitorToken);
      })
      .catch((error: unknown) => {
        console.error(error);
      });
  }, [workspace, storagePrefix]);

  useEffect(() => {
    if (!conversationId || !visitorToken) {
      return;
    }

    let source: EventSource | null = null;

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
        }
        return;
      }

      const payload = await response.json();
      setMessages(payload.messages ?? []);
      setMeta((previous) => payload.meta ?? previous);
    };

    const connectStream = () => {
      source = new EventSource(
        `/api/chat/stream?conversationId=${encodeURIComponent(conversationId)}&token=${encodeURIComponent(visitorToken)}`,
      );

      source.onerror = (error) => {
        console.warn("[chat:widget_stream_error]", error);
      };

      source.addEventListener("snapshot", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as {
          messages?: Message[];
          meta?: ChatMeta;
        };
        setMessages(payload.messages ?? []);
        setMeta((previous) => payload.meta ?? previous);
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
  }, [conversationId, visitorToken]);

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
      await fetch("/api/chat/messages", {
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

      setText("");
      await sendTyping(false);
    } finally {
      setIsSending(false);
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
                <small className={message.readByAgentAt ? "ticks read" : "ticks sent"}>
                  ✓✓
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
      </div>

      <footer className="widget-compose">
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            scheduleTyping(event.target.value.trim().length > 0);
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
          line-height: 1.35;
        }
        .bubble small {
          display: block;
          margin-top: 6px;
          font-size: 11px;
          opacity: 0.9;
        }
        .ticks {
          text-align: right;
        }
        .ticks.sent {
          color: rgba(255, 255, 255, 0.75);
        }
        .ticks.read {
          color: #36a3ff;
          font-weight: 700;
          transition: color 180ms ease-in;
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
        .widget-compose {
          border-top: 1px solid #e2d6c7;
          background: #fff;
          padding: 10px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
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
      `}</style>
    </div>
  );
}
