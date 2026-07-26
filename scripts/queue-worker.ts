import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env", override: false });

async function main() {
  const { startQueueWorker } = await import("../src/modules/queue/worker");
  const runtime = await startQueueWorker();
  let isShuttingDown = false;

  console.log("CCP queue worker started.");

  async function shutdown() {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    console.log("CCP queue worker shutting down.");
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
