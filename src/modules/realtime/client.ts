"use client";

import { io, type Socket } from "socket.io-client";

export type RealtimeEvent = {
  type: string;
  workspaceId: string | null;
  conversationId: string | null;
  version: number;
};

export function realtimeClientUrl() {
  const configured = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3001";
  }

  return null;
}

export function connectConversationSocket(input: {
  conversationId: string;
  workspaceId?: string;
  onEvent: (event: RealtimeEvent) => void;
  onState?: (state: "connected" | "disconnected") => void;
}) {
  const url = realtimeClientUrl();
  if (!url) {
    return null;
  }

  const socket: Socket = io(url, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4_000,
    query: {
      conversationId: input.conversationId,
      workspaceId: input.workspaceId,
    },
  });

  socket.on("connect", () => input.onState?.("connected"));
  socket.on("disconnect", () => input.onState?.("disconnected"));
  socket.on("conversation:event", input.onEvent);

  return socket;
}
