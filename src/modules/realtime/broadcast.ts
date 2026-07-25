import { serverEnv } from "@/lib/env";
import { chatLog } from "@/modules/chat/log";

type BroadcastInput = {
  type: "message.created" | "typing.updated" | "conversation.updated";
  workspaceId: string;
  conversationId: string;
};

function realtimeUrl() {
  if (serverEnv.REALTIME_SERVER_URL) {
    return serverEnv.REALTIME_SERVER_URL.replace(/\/$/, "");
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://127.0.0.1:3001";
  }

  return null;
}

export async function broadcastConversationEvent(input: BroadcastInput) {
  const baseUrl = realtimeUrl();
  if (!baseUrl) {
    return;
  }

  try {
    await fetch(`${baseUrl}/emit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-realtime-secret": serverEnv.REALTIME_INTERNAL_SECRET || "dev-realtime-secret",
      },
      body: JSON.stringify({
        ...input,
        version: Date.now(),
      }),
      signal: AbortSignal.timeout(900),
    });
  } catch (error) {
    chatLog("warn", "realtime_broadcast_failed", {
      conversationId: input.conversationId,
      type: input.type,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
}
