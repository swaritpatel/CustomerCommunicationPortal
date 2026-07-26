import { createHash } from "node:crypto";

import { db, type DbTransactionClient } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { chatLog } from "@/modules/chat/log";
import { generateEmailAcknowledgement } from "@/modules/email/ai-draft";
import { normalizeInboundEmail, resolveWorkspaceSlugFromRecipient } from "@/modules/email/inbound";
import { sendWorkspaceSupportEmail } from "@/modules/email/send";
import { dispatchEmailWebhookEvent } from "@/modules/email/webhooks";
import { findSuggestedKnowledgeArticles } from "@/modules/kb/suggestions";
import { findRelevantSupportPolicies } from "@/modules/policies/support-policies";
import { enqueueBackgroundJob } from "@/modules/queue/enqueue";
import { broadcastConversationEvent } from "@/modules/realtime/broadcast";
import { generateUniqueTicketNumber } from "@/modules/tickets/ticket-number";

function withTicketReference(text: string, ticketNumber: string) {
  if (text.includes(ticketNumber)) {
    return normalizeEmailText(text);
  }

  const lines = text.trim().split("\n");
  const greeting = lines[0] ?? "Hi there,";
  const body = lines.slice(1).join("\n").trim();

  return [
    greeting,
    "",
    `Ticket number: ${ticketNumber}`,
    "Please keep this ticket number for future reference.",
    ...(body ? ["", body] : []),
  ].join("\n");
}

function normalizeEmailText(text: string) {
  const appUrl = serverEnv.APP_URL.replace(/\/$/, "");
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/(?<!https?:\/\/[^\s]*)\/help\/[^\s)]+/g, (match) => `${appUrl}${match}`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildAcknowledgementText(input: { customerName: string | null; ticketNumber: string }) {
  const greetingName = input.customerName?.trim() || "there";

  return [
    `Hi ${greetingName},`,
    "",
    `Ticket number: ${input.ticketNumber}`,
    "Please keep this ticket number for future reference.",
    "",
    "Thank you for contacting Cosmofeed Support.",
    "",
    "We have received your message and our support team is reviewing the details.",
    "We will follow up on this email thread with the next update as soon as possible.",
    "",
    "Best,",
    "Cosmofeed Support",
  ].join("\n");
}

async function sendAcknowledgement(input: {
  workspaceId: string;
  conversationId: string;
  customerEmail: string;
  customerName: string | null;
  subject: string;
  inReplyTo: string;
  customerMessage: string;
  ticketNumber: string;
}) {
  const now = new Date();
  const subject = input.subject.startsWith("Re:") ? input.subject : `Re: ${input.subject}`;
  const recentAutoAck = await db.chatMessage.findFirst({
    where: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      senderType: "SYSTEM",
      body: { contains: input.ticketNumber, mode: "insensitive" },
      createdAt: {
        gte: new Date(now.getTime() - 10 * 60 * 1000),
      },
    },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  if (recentAutoAck) {
    chatLog("info", "email_auto_ack_recent_duplicate_skipped", {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      customerEmail: input.customerEmail,
      ticketNumber: input.ticketNumber,
      recentAutoAckId: recentAutoAck.id,
      recentAutoAckAt: recentAutoAck.createdAt.toISOString(),
    });
    return;
  }

  const fallbackText = buildAcknowledgementText({
    customerName: input.customerName,
    ticketNumber: input.ticketNumber,
  });
  const workspace = await db.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { slug: true },
  });
  const suggestedArticles = workspace
    ? await findSuggestedKnowledgeArticles({
        workspaceId: input.workspaceId,
        workspaceSlug: workspace.slug,
        text: `${input.subject}\n${input.customerMessage}`,
        take: 1,
      })
    : [];
  const aiAcknowledgement = await generateEmailAcknowledgement({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    customerName: input.customerName,
    subject: input.subject,
    customerMessage: input.customerMessage,
    policies: await findRelevantSupportPolicies({
      workspaceId: input.workspaceId,
      text: `${input.subject}\n${input.customerMessage}`,
    }),
    suggestedArticles,
  });
  const text = normalizeEmailText(aiAcknowledgement?.text
    ? withTicketReference(aiAcknowledgement.text, input.ticketNumber)
    : withTicketReference([
        fallbackText,
        ...(suggestedArticles.length > 0
          ? [
              "",
              `This help article may be useful: ${suggestedArticles[0].title}`,
              suggestedArticles[0].href,
            ]
          : []),
      ].join("\n"), input.ticketNumber));
  const shouldAutoResolve = Boolean(aiAcknowledgement?.shouldResolve);
  const references = [input.inReplyTo];
  const acknowledgementId = createHash("sha256").update(input.inReplyTo).digest("hex").slice(0, 16);

  chatLog("info", "email_auto_ack_text_prepared", {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    customerEmail: input.customerEmail,
    aiUsed: Boolean(aiAcknowledgement),
    aiModel: aiAcknowledgement?.model,
    autoResolveAfterSend: shouldAutoResolve,
    policyIds: aiAcknowledgement?.policyIds ?? [],
    articleLinks: suggestedArticles.map((article) => article.href),
    textLength: text.length,
  });

  chatLog("info", "email_auto_ack_enqueue_started", {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    customerEmail: input.customerEmail,
    subject,
    inReplyTo: input.inReplyTo,
    acknowledgementId,
    ticketNumber: input.ticketNumber,
  });

  const queued = await enqueueBackgroundJob({
    kind: "email.send",
    purpose: "AUTO_ACK",
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    customerEmail: input.customerEmail,
    subject,
    text,
    inReplyTo: input.inReplyTo,
    references,
    autoResolveAfterSend: shouldAutoResolve,
    autoResolvePolicyIds: aiAcknowledgement?.policyIds ?? [],
    webhookOccurredAt: now.toISOString(),
  }, {
    jobId: `email-auto-ack-${input.conversationId}-${acknowledgementId}`,
  });

  chatLog("info", queued ? "email_auto_ack_enqueued" : "email_auto_ack_queue_unavailable", {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    customerEmail: input.customerEmail,
    subject,
    inReplyTo: input.inReplyTo,
    acknowledgementId,
  });

  if (!queued) {
    const existingAutoAck = await db.emailMessageReference.findFirst({
      where: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        inReplyTo: input.inReplyTo,
        source: "OUTBOUND",
      },
      select: { id: true },
    });

    if (existingAutoAck) {
      chatLog("info", "email_auto_ack_direct_duplicate_skipped", {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        inReplyTo: input.inReplyTo,
      });
      return;
    }

    const outbound = await sendWorkspaceSupportEmail({
      workspaceId: input.workspaceId,
      to: input.customerEmail,
      subject,
      text,
      inReplyTo: input.inReplyTo,
      references,
    });

    await db.$transaction([
      db.emailMessageReference.create({
        data: {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          messageId: outbound.messageId,
          inReplyTo: input.inReplyTo,
          source: "OUTBOUND",
        },
      }),
      db.chatMessage.create({
        data: {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          senderType: "SYSTEM",
          body: text,
          readByAgentAt: now,
        },
      }),
      ...(shouldAutoResolve
        ? [
            db.conversation.update({
              where: { id: input.conversationId },
              data: {
                status: "RESOLVED",
                updatedAt: now,
              },
            }),
          ]
        : []),
    ]);

    if (shouldAutoResolve) {
      chatLog("info", "email_auto_ack_policy_resolved_direct", {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        policyIds: aiAcknowledgement?.policyIds ?? [],
      });
    }

    await dispatchEmailWebhookEvent({
      type: "email.reply.sent",
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      occurredAt: now.toISOString(),
      payload: {
        customerEmail: input.customerEmail,
        messageId: outbound.messageId,
      },
    });
  }

  await broadcastConversationEvent({
    type: "message.created",
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
  });
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function processInboundEmail(payload: unknown) {
  const startedAt = Date.now();
  const normalized = normalizeInboundEmail(payload);
  if (!normalized) {
    chatLog("warn", "email_inbound_invalid_payload");
    return { ok: false as const, status: 400, error: "Invalid payload" };
  }

  const workspaceSlug =
    normalized.workspaceSlug || resolveWorkspaceSlugFromRecipient(normalized.recipient);

  if (!workspaceSlug) {
    chatLog("warn", "email_inbound_workspace_slug_missing", {
      recipient: normalized.recipient,
      senderEmail: normalized.senderEmail,
      subject: normalized.subject,
      messageId: normalized.messageId,
    });
    return { ok: false as const, status: 400, error: "workspace slug not found" };
  }

  chatLog("info", "email_inbound_started", {
    workspaceSlug,
    recipient: normalized.recipient,
    senderEmail: normalized.senderEmail,
    subject: normalized.subject,
    messageId: normalized.messageId,
    inReplyTo: normalized.inReplyTo,
    referencesCount: normalized.references.length,
  });

  const workspace = await db.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { id: true },
  });

  if (!workspace) {
    chatLog("warn", "email_inbound_workspace_missing", { workspaceSlug });
    return { ok: false as const, status: 404, error: "Workspace not found" };
  }

  const duplicateRef = await db.emailMessageReference.findUnique({
    where: {
      workspaceId_messageId: {
        workspaceId: workspace.id,
        messageId: normalized.messageId,
      },
    },
    select: { conversationId: true },
  });

  if (duplicateRef) {
    chatLog("info", "email_inbound_duplicate_skipped", {
      workspaceId: workspace.id,
      conversationId: duplicateRef.conversationId,
      messageId: normalized.messageId,
      durationMs: Date.now() - startedAt,
    });
    return {
      ok: true as const,
      duplicate: true,
      workspaceId: workspace.id,
      conversationId: duplicateRef.conversationId,
    };
  }

  const threadCandidates = [
    normalized.inReplyTo,
    ...normalized.references,
    normalized.messageId,
  ].filter((entry): entry is string => Boolean(entry));

  const existingRef =
    threadCandidates.length > 0
      ? await db.emailMessageReference.findFirst({
          where: {
            workspaceId: workspace.id,
            messageId: { in: threadCandidates },
          },
          orderBy: { createdAt: "desc" },
          select: { conversationId: true },
        })
      : null;

  const now = new Date();
  const conversation = existingRef
    ? await db.conversation.findUnique({
        where: { id: existingRef.conversationId },
        select: { id: true, ticketNumber: true },
      })
    : await db.conversation.create({
        data: {
          workspaceId: workspace.id,
          ticketNumber: await generateUniqueTicketNumber({ workspaceId: workspace.id }),
          channel: "EMAIL",
          subject: normalized.subject,
          customerName: normalized.senderName,
          customerEmail: normalized.senderEmail,
          customerKey: normalized.messageId,
          status: "OPEN",
        },
        select: { id: true, ticketNumber: true },
      });

  if (!conversation) {
    chatLog("warn", "email_inbound_conversation_missing", {
      workspaceId: workspace.id,
      existingConversationId: existingRef?.conversationId,
      messageId: normalized.messageId,
    });
    return { ok: false as const, status: 404, error: "Conversation not found" };
  }

  chatLog("info", existingRef ? "email_inbound_thread_matched" : "email_inbound_conversation_created", {
    workspaceId: workspace.id,
    conversationId: conversation.id,
    ticketNumber: conversation.ticketNumber,
    messageId: normalized.messageId,
    inReplyTo: normalized.inReplyTo,
    threadCandidatesCount: threadCandidates.length,
  });

  let ticketNumber = conversation.ticketNumber;

  try {
    await db.$transaction(async (tx: DbTransactionClient) => {
      if (!ticketNumber) {
        ticketNumber = await generateUniqueTicketNumber({ workspaceId: workspace.id, tx });
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { ticketNumber },
        });
      }

      await tx.emailMessageReference.create({
        data: {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          messageId: normalized.messageId,
          inReplyTo: normalized.inReplyTo,
          source: "INBOUND",
        },
      });

      await tx.chatMessage.create({
        data: {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          senderType: "VISITOR",
          body: normalized.textBody || normalized.htmlBody || "(no content)",
          readByVisitorAt: now,
          readByAgentAt: null,
        },
      });

      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          updatedAt: now,
          customerName: normalized.senderName || undefined,
          customerEmail: normalized.senderEmail,
          subject: normalized.subject || undefined,
        },
      });
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await db.emailMessageReference.findUnique({
      where: {
        workspaceId_messageId: {
          workspaceId: workspace.id,
          messageId: normalized.messageId,
        },
      },
      select: { conversationId: true },
    });

    chatLog("info", "email_inbound_duplicate_race_skipped", {
      workspaceId: workspace.id,
      conversationId: existing?.conversationId ?? conversation.id,
      messageId: normalized.messageId,
      durationMs: Date.now() - startedAt,
    });

    return {
      ok: true as const,
      duplicate: true,
      workspaceId: workspace.id,
      conversationId: existing?.conversationId ?? conversation.id,
    };
  }

  await dispatchEmailWebhookEvent({
    type: "email.inbound.received",
    workspaceId: workspace.id,
    conversationId: conversation.id,
    occurredAt: now.toISOString(),
    payload: {
      customerEmail: normalized.senderEmail,
      subject: normalized.subject,
    },
  });

  await sendAcknowledgement({
    workspaceId: workspace.id,
    conversationId: conversation.id,
    customerEmail: normalized.senderEmail,
    customerName: normalized.senderName,
    subject: normalized.subject,
    inReplyTo: normalized.messageId,
    customerMessage: normalized.textBody || normalized.htmlBody || "",
    ticketNumber: ticketNumber!,
  }).catch((error) => {
    chatLog("warn", "email_auto_ack_failed", {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  });

  chatLog("info", "email_inbound_completed", {
    workspaceId: workspace.id,
    conversationId: conversation.id,
    messageId: normalized.messageId,
    subject: normalized.subject,
    durationMs: Date.now() - startedAt,
  });

  return {
    ok: true as const,
    workspaceId: workspace.id,
    conversationId: conversation.id,
  };
}
