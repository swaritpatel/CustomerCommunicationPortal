import http from "node:http";

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env", override: false });

async function main() {
  const { startQueueWorker } = await import("../src/modules/queue/worker");
  const runtime = await startQueueWorker();
  let isShuttingDown = false;
  const port = Number.parseInt(process.env.PORT || process.env.WORKER_HEALTH_PORT || "0", 10);
  const healthServer =
    port > 0
      ? http.createServer((request, response) => {
          if (request.method === "GET" && request.url === "/health") {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({ ok: true, service: "ccp-worker" }));
            return;
          }

          response.writeHead(404, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "Not found" }));
        })
      : null;

  if (healthServer) {
    await new Promise<void>((resolve) => {
      healthServer.listen(port, "0.0.0.0", resolve);
    });
    console.log(`CCP queue worker health server listening on http://0.0.0.0:${port}`);
  }

  console.log("CCP queue worker started.");

  async function shutdown() {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    console.log("CCP queue worker shutting down.");
    healthServer?.close();
    await runtime.close();
    process.exit(0);
  }

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main();
