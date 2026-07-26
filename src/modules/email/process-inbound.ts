import { db, type DbTransactionClient } from "@/lib/db";
import { chatLog } from "@/modules/chat/log";
import { normalizeInboundEmail, resolveWorkspaceSlugFromRecipient } from "@/modules/email/inbound";
import { sendSupportEmail } from "@/modules/email/smtp";
import { dispatchEmailWebhookEvent } from "@/modules/email/webhooks";
import { enqueueBackgroundJob } from "@/modules/queue/enqueue";
import { broadcastConversationEvent } from "@/modules/realtime/broadcast";

function buildAcknowledgementText(input: { customerName: string | null; subject: string }) {
  const greetingName = input.customerName?.trim() || "there";

  return [
    `Hi ${greetingName},`,
    "",
    `We have received your request about ${input.subject}.`,
    "Our support team is reviewing it now and will get back to you with the next steps shortly.",
    "",
    "Best,",
    "CCP Support",
  ].join("\n");
}

async function sendAcknowledgement(input: {
  workspaceId: string;
  conversationId: string;
  customerEmail: string;
  customerName: string | null;
  subject: string;
  inReplyTo: string;
}) {
  const now = new Date();
  const subject = input.subject.startsWith("Re:") ? input.subject : `Re: ${input.subject}`;
  const text = buildAcknowledgementText({
    customerName: input.customerName,
    subject: input.subject,
  });
  const references = [input.inReplyTo];

  await db.chatMessage.create({
    data: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      senderType: "SYSTEM",
      body: text,
      readByAgentAt: now,
    },
  });

  const queued = await enqueueBackgroundJob({
    kind: "email.send",
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    customerEmail: input.customerEmail,
    subject,
    text,
    inReplyTo: input.inReplyTo,
    references,
    webhookOccurredAt: now.toISOString(),
  });

  if (!queued) {
    const outbound = await sendSupportEmail({
      to: input.customerEmail,
      subject,
      text,
      inReplyTo: input.inReplyTo,
      references,
    });

    await db.emailMessageReference.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        messageId: outbound.messageId,
        inReplyTo: input.inReplyTo,
        source: "OUTBOUND",
      },
    });

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
  const normalized = normalizeInboundEmail(payload);
  if (!normalized) {
    return { ok: false as const, status: 400, error: "Invalid payload" };
  }

  const workspaceSlug =
    normalized.workspaceSlug || resolveWorkspaceSlugFromRecipient(normalized.recipient);

  if (!workspaceSlug) {
    return { ok: false as const, status: 400, error: "workspace slug not found" };
  }

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
  const isNewConversation = !existingRef;

  const conversation = existingRef
    ? await db.conversation.findUnique({
        where: { id: existingRef.conversationId },
        select: { id: true },
      })
    : await db.conversation.create({
        data: {
          workspaceId: workspace.id,
          channel: "EMAIL",
          subject: normalized.subject,
          customerName: normalized.senderName,
          customerEmail: normalized.senderEmail,
          customerKey: normalized.messageId,
          status: "OPEN",
        },
        select: { id: true },
      });

  if (!conversation) {
    return { ok: false as const, status: 404, error: "Conversation not found" };
  }

  try {
    await db.$transaction(async (tx: DbTransactionClient) => {
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

  if (isNewConversation) {
    await sendAcknowledgement({
      workspaceId: workspace.id,
      conversationId: conversation.id,
      customerEmail: normalized.senderEmail,
      customerName: normalized.senderName,
      subject: normalized.subject,
      inReplyTo: normalized.messageId,
    }).catch((error) => {
      chatLog("warn", "email_auto_ack_failed", {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    });
  }

  return {
    ok: true as const,
    workspaceId: workspace.id,
    conversationId: conversation.id,
  };
}
