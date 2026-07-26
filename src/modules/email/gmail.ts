import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { chatLog } from "@/modules/chat/log";
import { processInboundEmail } from "@/modules/email/process-inbound";
import { getErrorDetails } from "@/modules/observability/log";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

type GmailHeader = {
  name: string;
  value: string;
};

type GmailMessagePart = {
  mimeType?: string;
  body?: {
    data?: string;
  };
  parts?: GmailMessagePart[];
};

type GmailMessage = {
  id: string;
  threadId: string;
  historyId?: string;
  payload?: GmailMessagePart & {
    headers?: GmailHeader[];
  };
};

type GmailSendResponse = {
  id: string;
  threadId?: string;
};

export function isGmailConfigured() {
  return Boolean(
    serverEnv.GOOGLE_CLIENT_ID &&
      serverEnv.GOOGLE_CLIENT_SECRET &&
      serverEnv.GOOGLE_REDIRECT_URI,
  );
}

export function buildGoogleAuthUrl(state: string) {
  if (!isGmailConfigured()) {
    throw new Error("Gmail OAuth is not configured");
  }

  const params = new URLSearchParams({
    client_id: serverEnv.GOOGLE_CLIENT_ID!,
    redirect_uri: serverEnv.GOOGLE_REDIRECT_URI!,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: GMAIL_SCOPES.join(" "),
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: serverEnv.GOOGLE_CLIENT_ID!,
      client_secret: serverEnv.GOOGLE_CLIENT_SECRET!,
      redirect_uri: serverEnv.GOOGLE_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
  });

  const payload = (await response.json().catch(() => null)) as GoogleTokenResponse | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || "Google token exchange failed");
  }

  return payload;
}

async function refreshAccessToken(refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: serverEnv.GOOGLE_CLIENT_ID!,
      client_secret: serverEnv.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });

  const payload = (await response.json().catch(() => null)) as GoogleTokenResponse | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || "Google token refresh failed");
  }

  return payload;
}

export async function getGoogleProfile(accessToken: string) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Gmail profile fetch failed (${response.status})`);
  }

  return (await response.json()) as { emailAddress: string; historyId?: string };
}

async function getIntegrationAccessToken(integrationId: string) {
  const integration = await db.gmailIntegration.findUnique({
    where: { id: integrationId },
  });

  if (!integration) {
    throw new Error("Gmail integration not found");
  }

  if (
    integration.accessToken &&
    integration.expiresAt &&
    integration.expiresAt.getTime() > Date.now() + 60_000
  ) {
    return integration.accessToken;
  }

  const refreshed = await refreshAccessToken(integration.refreshToken);
  const expiresAt = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000)
    : null;

  await db.gmailIntegration.update({
    where: { id: integration.id },
    data: {
      accessToken: refreshed.access_token,
      expiresAt,
    },
  });

  return refreshed.access_token!;
}

function header(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64Url(value: string | undefined) {
  if (!value) {
    return "";
  }

  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function findBody(part: GmailMessagePart | undefined, mimeType: "text/plain" | "text/html"): string {
  if (!part) {
    return "";
  }

  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }

  for (const child of part.parts ?? []) {
    const found = findBody(child, mimeType);
    if (found) {
      return found;
    }
  }

  return "";
}

async function gmailFetch<T>(accessToken: string, path: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Gmail API request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function formatMessageId(value: string | null | undefined) {
  const normalized = value?.replace(/^<|>$/g, "").trim();
  return normalized ? `<${normalized}>` : undefined;
}

function encodeRawEmail(input: {
  fromEmail: string;
  fromName?: string | null;
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
}) {
  const from = input.fromName
    ? `"${sanitizeHeader(input.fromName).replace(/"/g, "'")}" <${input.fromEmail}>`
    : input.fromEmail;
  const references = input.references
    ?.map((reference) => formatMessageId(reference))
    .filter((reference): reference is string => Boolean(reference));
  const headers = [
    `From: ${from}`,
    `To: ${sanitizeHeader(input.to)}`,
    `Subject: ${sanitizeHeader(input.subject)}`,
    `Message-ID: ${formatMessageId(input.messageId)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    input.inReplyTo ? `In-Reply-To: ${formatMessageId(input.inReplyTo)}` : null,
    references && references.length > 0 ? `References: ${references.join(" ")}` : null,
  ].filter((header): header is string => Boolean(header));

  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${input.text}`, "utf8").toString("base64url");
}

export async function sendGmailSupportEmail(input: {
  workspaceId: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: string[];
}) {
  if (!isGmailConfigured()) {
    throw new Error("Gmail OAuth is not configured");
  }

  const integration = await db.gmailIntegration.findFirst({
    where: {
      workspaceId: input.workspaceId,
      ...(serverEnv.GMAIL_SUPPORT_EMAIL ? { email: serverEnv.GMAIL_SUPPORT_EMAIL } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!integration) {
    throw new Error("Gmail is not connected");
  }

  const domain = integration.email.split("@")[1] || "gmail.local";
  const messageId = `${randomUUID()}@${domain}`;
  const startedAt = Date.now();
  const accessToken = await getIntegrationAccessToken(integration.id);

  chatLog("info", "gmail_send_started", {
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    from: integration.email,
    to: input.to,
    subject: input.subject,
    messageId,
    inReplyTo: input.inReplyTo,
    referencesCount: input.references?.length ?? 0,
  });

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      raw: encodeRawEmail({
        fromEmail: integration.email,
        fromName: serverEnv.SMTP_FROM_NAME || "Cosmofeed Support",
        to: input.to,
        subject: input.subject,
        text: input.text,
        messageId,
        inReplyTo: input.inReplyTo,
        references: input.references,
      }),
    }),
  });

  const payload = (await response.json().catch(() => null)) as GmailSendResponse | { error?: { message?: string } } | null;

  if (!response.ok) {
    const message =
      payload && "error" in payload && payload.error?.message
        ? payload.error.message
        : `Gmail send failed (${response.status})`;
    chatLog("error", "gmail_send_failed", {
      workspaceId: input.workspaceId,
      integrationId: integration.id,
      from: integration.email,
      to: input.to,
      subject: input.subject,
      messageId,
      durationMs: Date.now() - startedAt,
      status: response.status,
      error: message,
    });
    throw new Error(message);
  }

  chatLog("info", "gmail_send_completed", {
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    from: integration.email,
    to: input.to,
    subject: input.subject,
    messageId,
    gmailMessageId: payload && "id" in payload ? payload.id : undefined,
    gmailThreadId: payload && "threadId" in payload ? payload.threadId : undefined,
    durationMs: Date.now() - startedAt,
  });

  return {
    messageId,
  };
}

export async function syncGmailInbox(input: {
  workspaceId: string;
  workspaceSlug: string;
  email?: string;
  maxResults?: number;
}) {
  const startedAt = Date.now();
  if (!isGmailConfigured()) {
    throw new Error("Gmail OAuth is not configured");
  }

  chatLog("info", "gmail_sync_started", {
    workspaceId: input.workspaceId,
    workspaceSlug: input.workspaceSlug,
    email: input.email || serverEnv.GMAIL_SUPPORT_EMAIL,
    maxResults: input.maxResults ?? 20,
  });

  const integration = await db.gmailIntegration.findFirst({
    where: {
      workspaceId: input.workspaceId,
      ...(input.email || serverEnv.GMAIL_SUPPORT_EMAIL
        ? { email: input.email || serverEnv.GMAIL_SUPPORT_EMAIL }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!integration) {
    throw new Error("Gmail is not connected");
  }

  const accessToken = await getIntegrationAccessToken(integration.id);
  const maxResults = String(input.maxResults ?? 20);
  const query = `in:inbox newer_than:30d -from:${integration.email}`;
  chatLog("info", "gmail_sync_listing_messages", {
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    email: integration.email,
    query,
    maxResults,
  });

  const list = await gmailFetch<{ messages?: { id: string }[] }>(
    accessToken,
    `messages?${new URLSearchParams({ maxResults, q: query }).toString()}`,
  );

  let imported = 0;
  let skipped = 0;
  let latestHistoryId = integration.historyId ?? null;

  for (const item of list.messages ?? []) {
    chatLog("debug", "gmail_sync_fetching_message", {
      workspaceId: input.workspaceId,
      integrationId: integration.id,
      gmailMessageId: item.id,
    });

    const message = await gmailFetch<GmailMessage>(
      accessToken,
      `messages/${encodeURIComponent(item.id)}?format=full`,
    );

    latestHistoryId = message.historyId ?? latestHistoryId;

    const headers = message.payload?.headers ?? [];
    const messageId = header(headers, "Message-ID") || `${message.id}@gmail.local`;
    const existing = await db.emailMessageReference.findUnique({
      where: {
        workspaceId_messageId: {
          workspaceId: input.workspaceId,
          messageId: messageId.replace(/^<|>$/g, ""),
        },
      },
      select: { id: true },
    });

    if (existing) {
      skipped += 1;
      chatLog("debug", "gmail_sync_message_duplicate_skipped", {
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        gmailMessageId: message.id,
        gmailThreadId: message.threadId,
        messageId: messageId.replace(/^<|>$/g, ""),
      });
      continue;
    }

    const text = findBody(message.payload, "text/plain");
    const html = findBody(message.payload, "text/html");
    const result = await processInboundEmail({
      workspaceSlug: input.workspaceSlug,
      recipient: header(headers, "To") || integration.email,
      from: header(headers, "From"),
      subject: header(headers, "Subject") || "No subject",
      text: text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      html,
      messageId,
      inReplyTo: header(headers, "In-Reply-To"),
      references: header(headers, "References"),
    });

    if (result.ok && !("duplicate" in result)) {
      imported += 1;
      chatLog("info", "gmail_sync_message_imported", {
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        conversationId: result.conversationId,
        gmailMessageId: message.id,
        gmailThreadId: message.threadId,
        messageId,
      });
    } else {
      skipped += 1;
      chatLog("info", "gmail_sync_message_skipped", {
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        gmailMessageId: message.id,
        gmailThreadId: message.threadId,
        messageId,
        result,
      });
    }
  }

  await db.gmailIntegration.update({
    where: { id: integration.id },
    data: {
      historyId: latestHistoryId ?? undefined,
      lastSyncedAt: new Date(),
    },
  });

  chatLog("info", "gmail_sync_completed", {
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    email: integration.email,
    imported,
    skipped,
    listed: list.messages?.length ?? 0,
    durationMs: Date.now() - startedAt,
  });

  return {
    email: integration.email,
    imported,
    skipped,
  };
}

export async function syncAllGmailInboxes(maxResults = 20) {
  const startedAt = Date.now();
  const integrations = await db.gmailIntegration.findMany({
    select: {
      workspaceId: true,
      email: true,
      workspace: {
        select: { slug: true },
      },
    },
    orderBy: { updatedAt: "asc" },
  });

  chatLog("info", "gmail_sync_all_started", {
    integrations: integrations.length,
    maxResults,
  });

  const results = [];
  for (const integration of integrations) {
    try {
      const result = await syncGmailInbox({
        workspaceId: integration.workspaceId,
        workspaceSlug: integration.workspace.slug,
        email: integration.email,
        maxResults,
      });
      results.push({ ok: true, ...result });
    } catch (error) {
      chatLog("warn", "gmail_sync_integration_failed", {
        workspaceId: integration.workspaceId,
        email: integration.email,
        error: getErrorDetails(error),
      });
      results.push({
        ok: false,
        email: integration.email,
        error: error instanceof Error ? error.message : "Gmail sync failed",
      });
    }
  }

  chatLog("info", "gmail_sync_all_completed", {
    integrations: integrations.length,
    results,
    durationMs: Date.now() - startedAt,
  });

  return results;
}
