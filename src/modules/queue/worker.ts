import { QueueEvents, Worker, type Job } from "bullmq";

import { db, type DbTransactionClient } from "@/lib/db";
import { runAutoReplyWorkflow } from "@/modules/chat/auto-reply";
import { chatLog } from "@/modules/chat/log";
import { sendSupportEmail } from "@/modules/email/smtp";
import { deliverEmailWebhookEvent } from "@/modules/email/webhooks";
import { getQueueConnection } from "@/modules/queue/connection";
import { CCP_QUEUE_NAME, type CcpJob, type EmailSendJob } from "@/modules/queue/jobs";
import { deliverConversationEvent } from "@/modules/realtime/broadcast";

async function processEmailSend(job: EmailSendJob) {
  const outbound = await sendSupportEmail({
    to: job.customerEmail,
    subject: job.subject,
    text: job.text,
    inReplyTo: job.inReplyTo,
    references: job.references,
  });

  await db.$transaction(async (tx: DbTransactionClient) => {
    await tx.emailMessageReference.create({
      data: {
        workspaceId: job.workspaceId,
        conversationId: job.conversationId,
        messageId: outbound.messageId,
        inReplyTo: job.inReplyTo,
        source: "OUTBOUND",
      },
    });
  });

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
}

async function processJob(job: Job<CcpJob>) {
  switch (job.data.kind) {
    case "realtime.broadcast":
      await deliverConversationEvent(job.data);
      return;
    case "email.webhook":
      await deliverEmailWebhookEvent(job.data.event);
      return;
    case "email.send":
      await processEmailSend(job.data);
      return;
    case "ai.autoReply":
      await runAutoReplyWorkflow(job.data);
      await deliverConversationEvent({
        type: "conversation.updated",
        workspaceId: job.data.workspaceId,
        conversationId: job.data.conversationId,
      });
      return;
  }
}

export async function startQueueWorker() {
  const connection = getQueueConnection();
  if (!connection) {
    throw new Error("REDIS_URL is required to start the queue worker");
  }

  const concurrency = Number.parseInt(process.env.QUEUE_CONCURRENCY || "4", 10);
  const worker = new Worker<CcpJob>(CCP_QUEUE_NAME, processJob, {
    connection,
    concurrency,
  });
  const events = new QueueEvents(CCP_QUEUE_NAME, { connection });

  worker.on("completed", (job) => {
    chatLog("info", "queue_job_completed", {
      id: job.id,
      kind: job.data.kind,
    });
  });

  worker.on("failed", (job, error) => {
    chatLog("error", "queue_job_failed", {
      id: job?.id,
      kind: job?.data.kind,
      error: error.message,
    });
  });

  await events.waitUntilReady();
  await worker.waitUntilReady();

  return {
    worker,
    events,
    async close() {
      await Promise.allSettled([worker.close(), events.close()]);
    },
  };
}
