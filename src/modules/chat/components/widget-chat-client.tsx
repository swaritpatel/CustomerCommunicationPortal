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

  return (
    <div className="widget-shell">
      <header className="widget-head">
        <div>
          <strong>RelayDesk Live Chat</strong>
          <p>{meta.agentOnline ? "Agent online" : "We reply quickly"}</p>
        </div>
        <button onClick={() => window.parent.postMessage("relaydesk:close", "*")}>✕</button>
      </header>

      <div className="widget-feed">
        {messages.map((message) => (
          <div
            key={message.id}
            className={message.senderType === "VISITOR" ? "bubble mine" : "bubble"}
          >
            {message.senderType === "AGENT" && message.senderUser?.fullName ? (
              <p className="author">{message.senderUser.fullName}</p>
            ) : null}
            <p>{message.body}</p>
            {message.senderType === "VISITOR" ? (
              <small>{message.readByAgentAt ? "Read" : "Sent"}</small>
            ) : null}
          </div>
        ))}
        {meta.agentTyping ? <p className="typing">Agent is typing...</p> : null}
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
          padding: 12px;
          border-bottom: 1px solid #e2d6c7;
          background: #fff;
        }
        .widget-head p {
          margin: 2px 0 0;
          font-size: 12px;
          color: #7d6b59;
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
        }
        .bubble {
          max-width: 82%;
          background: #ffffff;
          border: 1px solid #e8ddd0;
          border-radius: 14px 14px 14px 4px;
          padding: 10px;
        }
        .bubble.mine {
          margin-left: auto;
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
        .bubble p {
          margin: 0;
          white-space: pre-wrap;
        }
        .bubble small {
          display: block;
          margin-top: 6px;
          font-size: 11px;
          opacity: 0.8;
        }
        .typing {
          margin: 0;
          font-size: 12px;
          color: #7d6b59;
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
      `}</style>
    </div>
  );
}
