import http from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { config as loadEnv } from "dotenv";
import { createClient } from "redis";
import { Server } from "socket.io";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env", override: false });

const port = Number.parseInt(process.env.REALTIME_PORT || process.env.PORT || "3001", 10);
const internalSecret = process.env.REALTIME_INTERNAL_SECRET || "dev-realtime-secret";
const allowedOriginConfig =
  process.env.REALTIME_ALLOWED_ORIGINS ||
  process.env.APP_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "*";
const allowedOrigins = allowedOriginConfig
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const redisUrl = process.env.REDIS_URL;

let adapterMode = "memory";
let redisPublisher = null;
let redisSubscriber = null;

const httpServer = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "ccp-realtime", adapter: adapterMode }));
    return;
  }

  if (request.method === "POST" && request.url === "/emit") {
    if (request.headers["x-realtime-secret"] !== internalSecret) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    let rawBody = "";
    request.on("data", (chunk) => {
      rawBody += chunk;
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(rawBody || "{}");
        const event = {
          type: payload.type || "conversation.changed",
          workspaceId: payload.workspaceId || null,
          conversationId: payload.conversationId || null,
          version: payload.version || Date.now(),
        };

        if (event.conversationId) {
          io.to(`conversation:${event.conversationId}`).emit("conversation:event", event);
        }
        if (event.workspaceId) {
          io.to(`workspace:${event.workspaceId}`).emit("workspace:event", event);
        }

        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      } catch {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

async function configureRedisAdapter() {
  if (!redisUrl) {
    console.log("CCP realtime using in-memory Socket.IO adapter. Set REDIS_URL to scale across instances.");
    return;
  }

  redisPublisher = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 1_500,
      reconnectStrategy: false,
    },
  });
  redisSubscriber = redisPublisher.duplicate();

  redisPublisher.on("error", (error) => {
    console.warn("CCP realtime Redis publisher error:", error.message);
  });
  redisSubscriber.on("error", (error) => {
    console.warn("CCP realtime Redis subscriber error:", error.message);
  });

  try {
    await Promise.all([redisPublisher.connect(), redisSubscriber.connect()]);
    io.adapter(createAdapter(redisPublisher, redisSubscriber));
    adapterMode = "redis";
    console.log("CCP realtime using Redis Socket.IO adapter.");
  } catch (error) {
    adapterMode = "memory";
    console.warn("CCP realtime Redis adapter unavailable, falling back to memory:", error.message);
    await Promise.allSettled([
      redisPublisher?.quit(),
      redisSubscriber?.quit(),
    ]);
    redisPublisher = null;
    redisSubscriber = null;
  }
}

io.on("connection", (socket) => {
  const conversationId = typeof socket.handshake.query.conversationId === "string"
    ? socket.handshake.query.conversationId
    : null;
  const workspaceId = typeof socket.handshake.query.workspaceId === "string"
    ? socket.handshake.query.workspaceId
    : null;

  if (conversationId) {
    socket.join(`conversation:${conversationId}`);
  }
  if (workspaceId) {
    socket.join(`workspace:${workspaceId}`);
  }

  socket.emit("connection:state", {
    status: "connected",
    transport: socket.conn.transport.name,
    conversationId,
    workspaceId,
  });
});

await configureRedisAdapter();

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`CCP realtime server listening on http://0.0.0.0:${port}`);
});

async function shutdown() {
  console.log("CCP realtime server shutting down.");
  io.close();
  httpServer.close();
  await Promise.allSettled([
    redisPublisher?.quit(),
    redisSubscriber?.quit(),
  ]);
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
