import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { chatLog } from "@/modules/chat/log";
import { syncGmailInbox } from "@/modules/email/gmail";
import { withApiLogging } from "@/modules/observability/api";
import { getErrorDetails } from "@/modules/observability/log";

type PubSubPushBody = {
  message?: {
    data?: string;
    messageId?: string;
    message_id?: string;
    publishTime?: string;
    publish_time?: string;
  };
  subscription?: string;
};

type GmailPushPayload = {
  emailAddress?: string;
  historyId?: string;
};

function decodePubSubData(data: string | undefined) {
  if (!data) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf8")) as GmailPushPayload;
  } catch {
    return null;
  }
}

async function POSTHandler(request: Request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const expectedSecret = serverEnv.GMAIL_PUSH_WEBHOOK_SECRET;

  chatLog("info", "gmail_push_request_started", {
    hasConfiguredSecret: Boolean(expectedSecret),
    hasProvidedSecret: url.searchParams.has("secret"),
  });

  if (expectedSecret && url.searchParams.get("secret") !== expectedSecret) {
    chatLog("warn", "gmail_push_unauthorized", {
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as PubSubPushBody | null;
  const pushPayload = decodePubSubData(body?.message?.data);
  const email = pushPayload?.emailAddress?.toLowerCase();
  const historyId = pushPayload?.historyId;

  chatLog("info", "gmail_push_received", {
    subscription: body?.subscription,
    pubsubMessageId: body?.message?.messageId || body?.message?.message_id,
    publishTime: body?.message?.publishTime || body?.message?.publish_time,
    email,
    historyId,
  });

  if (!email) {
    chatLog("warn", "gmail_push_skipped_missing_email", {
      subscription: body?.subscription,
      pubsubMessageId: body?.message?.messageId || body?.message?.message_id,
      hasData: Boolean(body?.message?.data),
      decoded: Boolean(pushPayload),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, skipped: true, reason: "missing_email" }, { status: 202 });
  }

  chatLog("info", "gmail_push_lookup_started", {
    email,
    historyId,
  });

  const integrations = await db.gmailIntegration.findMany({
    where: { email },
    select: {
      id: true,
      workspaceId: true,
      email: true,
      workspace: {
        select: { slug: true },
      },
    },
  });

  if (integrations.length === 0) {
    chatLog("warn", "gmail_push_no_integration", {
      email,
      historyId,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, skipped: true, reason: "integration_not_found" }, { status: 202 });
  }

  chatLog("info", "gmail_push_integrations_found", {
    email,
    historyId,
    integrations: integrations.length,
  });

  const results = [];
  for (const integration of integrations) {
    const syncStartedAt = Date.now();
    try {
      chatLog("info", "gmail_push_sync_started", {
        workspaceId: integration.workspaceId,
        workspaceSlug: integration.workspace.slug,
        integrationId: integration.id,
        email: integration.email,
        historyId,
      });

      const result = await syncGmailInbox({
        workspaceId: integration.workspaceId,
        workspaceSlug: integration.workspace.slug,
        email: integration.email,
        maxResults: 20,
      });

      chatLog("info", "gmail_push_sync_completed", {
        workspaceId: integration.workspaceId,
        workspaceSlug: integration.workspace.slug,
        integrationId: integration.id,
        email: integration.email,
        historyId,
        imported: result.imported,
        skipped: result.skipped,
        durationMs: Date.now() - syncStartedAt,
      });

      results.push({ ok: true, ...result });
    } catch (error) {
      chatLog("error", "gmail_push_sync_failed", {
        workspaceId: integration.workspaceId,
        workspaceSlug: integration.workspace.slug,
        integrationId: integration.id,
        email: integration.email,
        historyId,
        durationMs: Date.now() - syncStartedAt,
        error: getErrorDetails(error),
      });
      results.push({
        ok: false,
        email: integration.email,
        error: error instanceof Error ? error.message : "Gmail push sync failed",
      });
    }
  }

  chatLog("info", "gmail_push_request_completed", {
    email,
    historyId,
    integrations: integrations.length,
    results,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({ ok: true, email, historyId, results });
}

export const POST = withApiLogging(POSTHandler, "POST src/app/api/email/gmail/push");
