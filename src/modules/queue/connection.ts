import type { ConnectionOptions } from "bullmq";

import { serverEnv } from "@/lib/env";

export function getQueueConnection(): ConnectionOptions | null {
  if (!serverEnv.REDIS_URL) {
    return null;
  }

  const url = new URL(serverEnv.REDIS_URL);

  return {
    host: url.hostname,
    port: Number(url.port || "6379"),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
