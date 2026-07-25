import http from "node:http";
import { Server } from "socket.io";

const port = Number.parseInt(process.env.REALTIME_PORT || "3001", 10);
const internalSecret = process.env.REALTIME_INTERNAL_SECRET || "dev-realtime-secret";
const allowedOrigin = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "*";

const httpServer = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "ccp-realtime" }));
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
    origin: allowedOrigin === "*" ? true : allowedOrigin,
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

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

httpServer.listen(port, () => {
  console.log(`CCP realtime server listening on http://localhost:${port}`);
});
