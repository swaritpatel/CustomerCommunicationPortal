import { parseMailbox, normalizeMessageId, splitReferenceHeader } from "@/modules/email/address";
import type { NormalizedInboundEmail } from "@/modules/email/types";

type InboundEmailPayload = {
  workspaceSlug?: string;
  recipient?: string;
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
};

export function normalizeInboundEmail(input: unknown): NormalizedInboundEmail | null {
  const payload = input as InboundEmailPayload | null;
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const fromMailbox = parseMailbox(payload.from);
  if (!fromMailbox) {
    return null;
  }

  const textBody = payload.text?.trim() || "";
  const htmlBody = payload.html?.trim() || null;
  if (!textBody && !htmlBody) {
    return null;
  }

  const messageId = normalizeMessageId(payload.messageId);
  if (!messageId) {
    return null;
  }

  return {
    workspaceSlug: payload.workspaceSlug?.trim() || undefined,
    recipient: payload.recipient?.trim() || undefined,
    senderEmail: fromMailbox.email,
    senderName: fromMailbox.name,
    subject: payload.subject?.trim() || "No subject",
    textBody,
    htmlBody,
    messageId,
    inReplyTo: normalizeMessageId(payload.inReplyTo),
    references: splitReferenceHeader(payload.references),
  };
}

export function resolveWorkspaceSlugFromRecipient(recipient: string | undefined) {
  if (!recipient) {
    return null;
  }

  const mailbox = parseMailbox(recipient);
  const target = mailbox?.email ?? recipient;
  const localPart = target.split("@")[0] ?? "";
  const parts = localPart.split("+");
  if (parts.length < 2) {
    return null;
  }

  const slug = parts[1]?.trim().toLowerCase();
  return slug || null;
}
