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
  html?: string;
  inReplyTo?: string | null;
  references?: string[];
}) {
  if (!isSmtpConfigured()) {
    throw new Error("SMTP is not configured");
  }

  const domain =
    serverEnv.SMTP_FROM_EMAIL?.split("@")[1] ||
    serverEnv.INBOUND_EMAIL_DOMAIN ||
    "relaydesk.local";
  const messageId = `<${randomUUID()}@${domain}>`;
  const startedAt = Date.now();
  const attempts = getSmtpAttempts();

  chatLog("info", "smtp_send_started", {
    to: input.to,
    subject: input.subject,
    messageId,
    inReplyTo: input.inReplyTo,
    referencesCount: input.references?.length ?? 0,
    attempts: attempts.map((attempt) => ({
      host: attempt.host,
      port: attempt.port,
      secure: attempt.secure,
    })),
  });

  let lastError: unknown = null;

  for (const [index, attempt] of attempts.entries()) {
    const attemptStartedAt = Date.now();
    const transporter = nodemailer.createTransport({
      host: attempt.host,
      port: attempt.port,
      secure: attempt.secure,
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 45_000,
      auth: {
        user: serverEnv.SMTP_USER,
        pass: serverEnv.SMTP_PASS,
      },
    });

    chatLog("info", "smtp_send_attempt_started", {
      to: input.to,
      subject: input.subject,
      messageId,
      host: attempt.host,
      port: attempt.port,
      secure: attempt.secure,
      attempt: index + 1,
      attempts: attempts.length,
    });

    const result = await transporter.sendMail({
      from: serverEnv.SMTP_FROM_NAME
        ? `\"${serverEnv.SMTP_FROM_NAME}\" <${serverEnv.SMTP_FROM_EMAIL}>`
        : serverEnv.SMTP_FROM_EMAIL,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html ?? textToHtml(input.text),
      messageId,
      inReplyTo: input.inReplyTo || undefined,
      references: input.references && input.references.length > 0 ? input.references : undefined,
    }).catch((error: unknown) => {
      lastError = error;
      chatLog("warn", "smtp_send_attempt_failed", {
        to: input.to,
        subject: input.subject,
        messageId,
        host: attempt.host,
        port: attempt.port,
        secure: attempt.secure,
        attempt: index + 1,
        attempts: attempts.length,
        durationMs: Date.now() - attemptStartedAt,
        error: getErrorDetails(error),
      });

      if (index < attempts.length - 1 && isConnectionTimeout(error)) {
        return null;
      }

      throw error;
    });

    if (!result) {
      continue;
    }

    chatLog("info", "smtp_send_completed", {
      to: input.to,
      subject: input.subject,
      messageId,
      host: attempt.host,
      port: attempt.port,
      secure: attempt.secure,
      response: result.response,
      accepted: result.accepted,
      rejected: result.rejected,
      durationMs: Date.now() - startedAt,
    });

    return {
      messageId: messageId.replace(/^<|>$/g, ""),
    };
  }

  chatLog("error", "smtp_send_failed", {
    to: input.to,
    subject: input.subject,
    messageId,
    durationMs: Date.now() - startedAt,
    error: getErrorDetails(lastError),
  });
  throw lastError instanceof Error ? lastError : new Error("SMTP send failed");
}

function getSmtpAttempts() {
  const primary = {
    host: serverEnv.SMTP_HOST!,
    port: serverEnv.SMTP_PORT!,
    secure: Boolean(serverEnv.SMTP_SECURE),
  };
  const attempts = [primary];
  const host = primary.host.toLowerCase();

  if (host.includes("brevo.com")) {
    for (const attempt of [
      { host: primary.host, port: 2525, secure: false },
      { host: primary.host, port: 465, secure: true },
    ]) {
      if (!attempts.some((entry) => entry.port === attempt.port && entry.secure === attempt.secure)) {
        attempts.push(attempt);
      }
    }
  }

  return attempts;
}

function isConnectionTimeout(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /timeout|etimedout|econnrefused|econnreset/i.test(error.message);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function textToHtml(text: string) {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#202124;">',
    ...paragraphs.map((paragraph) => `<p style="margin:0 0 14px;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`),
    "</div>",
  ].join("");
}
