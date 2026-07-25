import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { sendSupportEmail } from "@/modules/email/smtp";
import { dispatchEmailWebhookEvent } from "@/modules/email/webhooks";

type EmailReferenceItem = {
  messageId: string;
};

export async function POST(request: Request) {
  try {
    const claims = await getSessionClaims();
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { conversationId?: string; text?: string }
      | null;

    const conversationId = body?.conversationId;
    const text = body?.text?.trim();

    if (!conversationId || !text) {
      return NextResponse.json({ error: "conversationId and text are required" }, { status: 400 });
    }

    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        workspaceId: true,
        channel: true,
        customerEmail: true,
        subject: true,
      },
    });

    if (!conversation || conversation.channel !== "EMAIL") {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const membership = await db.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: conversation.workspaceId,
          userId: claims.sub,
        },
      },
      select: { id: true, status: true },
    });

    if (!membership || membership.status !== "ACTIVE") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!conversation.customerEmail) {
      return NextResponse.json({ error: "Conversation is missing customer email" }, { status: 400 });
    }

    const latestReferences: EmailReferenceItem[] = await db.emailMessageReference.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { messageId: true },
    });

    const inReplyTo = latestReferences[0]?.messageId ?? null;
    const references = latestReferences.map((entry: EmailReferenceItem) => entry.messageId);

    const outbound = await sendSupportEmail({
      to: conversation.customerEmail,
      subject: conversation.subject.startsWith("Re:")
        ? conversation.subject
        : `Re: ${conversation.subject}`,
      text,
      inReplyTo,
      references,
    });

    const now = new Date();

    await db.$transaction(async (tx) => {
      await tx.chatMessage.create({
        data: {
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          senderType: "AGENT",
          senderUserId: claims.sub,
          body: text,
          readByAgentAt: now,
        },
      });

      await tx.emailMessageReference.create({
        data: {
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          messageId: outbound.messageId,
          inReplyTo,
          source: "OUTBOUND",
        },
      });

      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          updatedAt: now,
          status: "OPEN",
        },
      });
    });

    await dispatchEmailWebhookEvent({
      type: "email.reply.sent",
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      occurredAt: now.toISOString(),
      payload: {
        customerEmail: conversation.customerEmail,
        messageId: outbound.messageId,
      },
    });

    return NextResponse.json({ ok: true, messageId: outbound.messageId });
  } catch (error) {
    chatLog("error", "email_reply_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
