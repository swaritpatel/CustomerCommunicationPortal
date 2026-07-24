import { randomUUID } from "node:crypto";

import nodemailer from "nodemailer";

import { serverEnv } from "@/lib/env";

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

  await transporter.sendMail({
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

  return {
    messageId: messageId.replace(/^<|>$/g, ""),
  };
}
