import { serverEnv } from "@/lib/env";
import { chatLog } from "@/modules/chat/log";
import { enqueueBackgroundJob } from "@/modules/queue/enqueue";

type EmailWebhookEventType =
  | "email.inbound.received"
  | "email.reply.sent"
  | "email.sla.first_response_breached"
  | "email.sla.resolution_breached";

type EmailWebhookEvent = {
  type: EmailWebhookEventType;
  workspaceId: string;
  conversationId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

function getWebhookTargets() {
  const urls = serverEnv.EMAIL_WEBHOOK_URLS;
  if (!urls) {
    return [] as string[];
  }

  return urls
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

export async function dispatchEmailWebhookEvent(event: EmailWebhookEvent) {
  const enqueued = await enqueueBackgroundJob({
    kind: "email.webhook",
    event,
  });

  if (enqueued) {
    return;
  }

  await deliverEmailWebhookEvent(event);
}

export async function deliverEmailWebhookEvent(event: EmailWebhookEvent) {
  const targets = getWebhookTargets();
  if (targets.length === 0) {
    return;
  }

  await Promise.allSettled(
    targets.map(async (url) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-relaydesk-event": event.type,
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        throw new Error(`Webhook ${url} responded with ${response.status}`);
      }
    }),
  ).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") {
        chatLog("warn", "email_webhook_dispatch_failed", {
          error: result.reason instanceof Error ? result.reason.message : "unknown_error",
        });
      }
    }
  });
}
