import { db, type DbTransactionClient } from "@/lib/db";
import { chatLog } from "@/modules/chat/log";
import { normalizeInboundEmail, resolveWorkspaceSlugFromRecipient } from "@/modules/email/inbound";
import { dispatchEmailWebhookEvent } from "@/modules/email/webhooks";

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

  await db.$transaction(async (tx: DbTransactionClient) => {
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

    await tx.emailMessageReference.upsert({
      where: {
        workspaceId_messageId: {
          workspaceId: workspace.id,
          messageId: normalized.messageId,
        },
      },
      create: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        messageId: normalized.messageId,
        inReplyTo: normalized.inReplyTo,
        source: "INBOUND",
      },
      update: {
        inReplyTo: normalized.inReplyTo,
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

  return {
    ok: true as const,
    workspaceId: workspace.id,
    conversationId: conversation.id,
  };
}
