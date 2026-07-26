import { randomUUID } from "node:crypto";

import nodemailer from "nodemailer";

import { serverEnv } from "@/lib/env";
import { chatLog } from "@/modules/chat/log";
import { getErrorDetails } from "@/modules/observability/log";

export function isSmtpConfigured() {
  return Boolean(
    serverEnv.SMTP_HOST &&
      serverEnv.SMTP_PORT &&
      serverEnv.SMTP_USER &&
      serverEnv.SMTP_PASS &&
      serverEnv.SMTP_FROM_EMAIL,
  );
}

export async function sendSupportEmail(input: {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: string[];
}) {
  if (!isSmtpConfigured()) {
    throw new Error("SMTP is not configured");
  }

  const transporter = nodemailer.createTransport({
    host: serverEnv.SMTP_HOST,
    port: serverEnv.SMTP_PORT,
    secure: Boolean(serverEnv.SMTP_SECURE),
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 45_000,
    auth: {
      user: serverEnv.SMTP_USER,
      pass: serverEnv.SMTP_PASS,
    },
  });

  const domain =
    serverEnv.SMTP_FROM_EMAIL?.split("@")[1] ||
    serverEnv.INBOUND_EMAIL_DOMAIN ||
    "relaydesk.local";
  const messageId = `<${randomUUID()}@${domain}>`;
  const startedAt = Date.now();

  chatLog("info", "smtp_send_started", {
    to: input.to,
    subject: input.subject,
    messageId,
    inReplyTo: input.inReplyTo,
    referencesCount: input.references?.length ?? 0,
    host: serverEnv.SMTP_HOST,
    port: serverEnv.SMTP_PORT,
    secure: Boolean(serverEnv.SMTP_SECURE),
  });

  try {
    const result = await transporter.sendMail({
      from: serverEnv.SMTP_FROM_NAME
        ? `\"${serverEnv.SMTP_FROM_NAME}\" <${serverEnv.SMTP_FROM_EMAIL}>`
        : serverEnv.SMTP_FROM_EMAIL,
      to: input.to,
      subject: input.subject,
      text: input.text,
      messageId,
      inReplyTo: input.inReplyTo || undefined,
      references: input.references && input.references.length > 0 ? input.references : undefined,
    });

    chatLog("info", "smtp_send_completed", {
      to: input.to,
      subject: input.subject,
      messageId,
      response: result.response,
      accepted: result.accepted,
      rejected: result.rejected,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    chatLog("error", "smtp_send_failed", {
      to: input.to,
      subject: input.subject,
      messageId,
      durationMs: Date.now() - startedAt,
      error: getErrorDetails(error),
    });
    throw error;
  }

  return {
    messageId: messageId.replace(/^<|>$/g, ""),
  };
}
