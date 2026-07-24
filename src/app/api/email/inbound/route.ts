import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { normalizeInboundEmail, resolveWorkspaceSlugFromRecipient } from "@/modules/email/inbound";
import { chatLog } from "@/modules/chat/log";

function isInboundAuthorized(request: Request) {
  if (!serverEnv.INBOUND_EMAIL_WEBHOOK_SECRET) {
    return true;
  }

  const token = request.headers.get("x-relaydesk-email-secret")?.trim();
  return token === serverEnv.INBOUND_EMAIL_WEBHOOK_SECRET;
}

export async function POST(request: Request) {
  try {
    if (!isInboundAuthorized(request)) {
      chatLog("warn", "email_inbound_unauthorized");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await request.json().catch(() => null);
    const normalized = normalizeInboundEmail(payload);
    if (!normalized) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const workspaceSlug =
      normalized.workspaceSlug || resolveWorkspaceSlugFromRecipient(normalized.recipient);

    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspace slug not found" }, { status: 400 });
    }

    const workspace = await db.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { id: true },
    });

    if (!workspace) {
      chatLog("warn", "email_inbound_workspace_missing", { workspaceSlug });
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
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
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    await db.$transaction(async (tx) => {
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

    return NextResponse.json({ ok: true, conversationId: conversation.id });
  } catch (error) {
    chatLog("error", "email_inbound_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
