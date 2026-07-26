import { QueueEvents, Worker, type Job } from "bullmq";

import { db } from "@/lib/db";
import { runAutoReplyWorkflow } from "@/modules/chat/auto-reply";
import { chatLog } from "@/modules/chat/log";
import { renewAllGmailWatches, syncAllGmailInboxes } from "@/modules/email/gmail";
import { sendWorkspaceSupportEmail } from "@/modules/email/send";
import { deliverEmailWebhookEvent } from "@/modules/email/webhooks";
import { getErrorDetails } from "@/modules/observability/log";
import { getQueueConnection } from "@/modules/queue/connection";
import { CCP_QUEUE_NAME, type CcpJob, type EmailSendJob } from "@/modules/queue/jobs";
import { deliverConversationEvent } from "@/modules/realtime/broadcast";

async function processEmailSend(job: EmailSendJob) {
  const startedAt = Date.now();
  chatLog("info", "email_send_job_started", {
    purpose: job.purpose ?? "AGENT_REPLY",
    workspaceId: job.workspaceId,
    conversationId: job.conversationId,
    customerEmail: job.customerEmail,
    subject: job.subject,
    inReplyTo: job.inReplyTo,
    referencesCount: job.references.length,
  });

  if (job.purpose === "AUTO_ACK" && job.inReplyTo) {
    const [existingAutoAck, recentAutoAck] = await Promise.all([
      db.emailMessageReference.findFirst({
        where: {
          workspaceId: job.workspaceId,
          conversationId: job.conversationId,
          inReplyTo: job.inReplyTo,
          source: "OUTBOUND",
        },
        select: { id: true },
      }),
      db.chatMessage.findFirst({
        where: {
          workspaceId: job.workspaceId,
          conversationId: job.conversationId,
          senderType: "SYSTEM",
          body: { equals: job.text },
          createdAt: {
            gte: new Date(Date.now() - 10 * 60 * 1000),
          },
        },
        select: { id: true },
      }),
    ]);

    if (existingAutoAck || recentAutoAck) {
      chatLog("info", "email_auto_ack_duplicate_skipped", {
        conversationId: job.conversationId,
        existingAutoAckId: existingAutoAck?.id,
        recentAutoAckId: recentAutoAck?.id,
      });
      return;
    }
  }

  const outbound = await sendWorkspaceSupportEmail({
    workspaceId: job.workspaceId,
    to: job.customerEmail,
    subject: job.subject,
    text: job.text,
    inReplyTo: job.inReplyTo,
    references: job.references,
  });

  if (job.purpose === "AUTO_ACK") {
    const now = new Date();
    await db.$transaction([
      db.emailMessageReference.create({
        data: {
          workspaceId: job.workspaceId,
          conversationId: job.conversationId,
          messageId: outbound.messageId,
          inReplyTo: job.inReplyTo,
          source: "OUTBOUND",
        },
      }),
      db.chatMessage.create({
        data: {
          workspaceId: job.workspaceId,
          conversationId: job.conversationId,
          senderType: "SYSTEM",
          body: job.text,
          readByAgentAt: new Date(job.webhookOccurredAt),
        },
      }),
      ...(job.autoResolveAfterSend
        ? [
            db.conversation.update({
              where: { id: job.conversationId },
              data: {
                status: "RESOLVED",
                updatedAt: now,
              },
            }),
          ]
        : []),
    ]);

    if (job.autoResolveAfterSend) {
      chatLog("info", "email_auto_ack_policy_resolved", {
        workspaceId: job.workspaceId,
        conversationId: job.conversationId,
        policyIds: job.autoResolvePolicyIds ?? [],
      });
    }
  } else {
    await db.emailMessageReference.create({
      data: {
        workspaceId: job.workspaceId,
        conversationId: job.conversationId,
        messageId: outbound.messageId,
        inReplyTo: job.inReplyTo,
        source: "OUTBOUND",
      },
    });
  }

  await deliverEmailWebhookEvent({
    type: "email.reply.sent",
    workspaceId: job.workspaceId,
    conversationId: job.conversationId,
    occurredAt: job.webhookOccurredAt,
    payload: {
      customerEmail: job.customerEmail,
      messageId: outbound.messageId,
    },
  });

  await deliverConversationEvent({
    type: "message.created",
    workspaceId: job.workspaceId,
    conversationId: job.conversationId,
  });

  chatLog("info", "email_send_job_completed", {
    purpose: job.purpose ?? "AGENT_REPLY",
    workspaceId: job.workspaceId,
    conversationId: job.conversationId,
    customerEmail: job.customerEmail,
    subject: job.subject,
    outboundMessageId: outbound.messageId,
    durationMs: Date.now() - startedAt,
  });
}

async function processJob(job: Job<CcpJob>) {
  const startedAt = Date.now();
  chatLog("info", "queue_job_started", {
    id: job.id,
    kind: job.data.kind,
    attemptsMade: job.attemptsMade,
    conversationId: "conversationId" in job.data ? job.data.conversationId : undefined,
    workspaceId: "workspaceId" in job.data ? job.data.workspaceId : undefined,
  });

  switch (job.data.kind) {
    case "realtime.broadcast":
      await deliverConversationEvent(job.data);
      break;
    case "email.webhook":
      await deliverEmailWebhookEvent(job.data.event);
      break;
    case "email.send":
      await processEmailSend(job.data);
      break;
    case "ai.autoReply":
      await runAutoReplyWorkflow(job.data);
      await deliverConversationEvent({
        type: "conversation.updated",
        workspaceId: job.data.workspaceId,
        conversationId: job.data.conversationId,
      });
      break;
  }

  chatLog("info", "queue_job_processed", {
    id: job.id,
    kind: job.data.kind,
    attemptsMade: job.attemptsMade,
    conversationId: "conversationId" in job.data ? job.data.conversationId : undefined,
    workspaceId: "workspaceId" in job.data ? job.data.workspaceId : undefined,
    durationMs: Date.now() - startedAt,
  });
}

export async function startQueueWorker() {
  const connection = getQueueConnection();
  if (!connection) {
    throw new Error("REDIS_URL is required to start the queue worker");
  }

  const concurrency = Number.parseInt(process.env.QUEUE_CONCURRENCY || "4", 10);
  chatLog("info", "queue_worker_starting", {
    queueName: CCP_QUEUE_NAME,
    concurrency,
    gmailSyncIntervalMs: process.env.GMAIL_SYNC_INTERVAL_MS || "60000",
    gmailWatchRenewIntervalMs: process.env.GMAIL_WATCH_RENEW_INTERVAL_MS || "21600000",
  });

  const worker = new Worker<CcpJob>(CCP_QUEUE_NAME, processJob, {
    connection,
    concurrency,
  });
  const events = new QueueEvents(CCP_QUEUE_NAME, { connection });

  worker.on("completed", (job) => {
    chatLog("info", "queue_job_completed", {
      id: job.id,
      kind: job.data.kind,
      attemptsMade: job.attemptsMade,
      conversationId: "conversationId" in job.data ? job.data.conversationId : undefined,
      workspaceId: "workspaceId" in job.data ? job.data.workspaceId : undefined,
    });
  });

  worker.on("failed", (job, error) => {
    chatLog("error", "queue_job_failed", {
      id: job?.id,
      kind: job?.data.kind,
      attemptsMade: job?.attemptsMade,
      failedReason: job?.failedReason,
      conversationId: job?.data && "conversationId" in job.data ? job.data.conversationId : undefined,
      workspaceId: job?.data && "workspaceId" in job.data ? job.data.workspaceId : undefined,
      error: getErrorDetails(error),
    });
  });

  await events.waitUntilReady();
  await worker.waitUntilReady();

  const syncIntervalMs = Number.parseInt(process.env.GMAIL_SYNC_INTERVAL_MS || "60000", 10);
  const gmailSyncTimer =
    syncIntervalMs > 0
      ? setInterval(() => {
          chatLog("debug", "gmail_poll_tick", { syncIntervalMs });
          void syncAllGmailInboxes(20)
            .then((results) => {
              const imported = results.reduce(
                (sum, result) => sum + ("imported" in result ? result.imported : 0),
                0,
              );
              if (imported > 0) {
                chatLog("info", "gmail_poll_imported", { imported });
              }
            })
            .catch((error) => {
              chatLog("warn", "gmail_poll_failed", {
                error: error instanceof Error ? error.message : "unknown_error",
              });
            });
        }, syncIntervalMs)
      : null;

  const watchRenewIntervalMs = Number.parseInt(process.env.GMAIL_WATCH_RENEW_INTERVAL_MS || "21600000", 10);
  const gmailWatchRenewTimer =
    watchRenewIntervalMs > 0
      ? setInterval(() => {
          chatLog("debug", "gmail_watch_renew_tick", { watchRenewIntervalMs });
          void renewAllGmailWatches().catch((error) => {
            chatLog("warn", "gmail_watch_renew_tick_failed", {
              error: error instanceof Error ? error.message : "unknown_error",
            });
          });
        }, watchRenewIntervalMs)
      : null;

  void renewAllGmailWatches().catch((error) => {
    chatLog("warn", "gmail_watch_initial_renew_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
  });

  return {
    worker,
    events,
    async close() {
      if (gmailSyncTimer) {
        clearInterval(gmailSyncTimer);
      }
      if (gmailWatchRenewTimer) {
        clearInterval(gmailWatchRenewTimer);
      }
      await Promise.allSettled([worker.close(), events.close()]);
    },
  };
}
