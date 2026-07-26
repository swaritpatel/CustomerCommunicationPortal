import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";
import { chatLog } from "@/modules/chat/log";
import { processInboundEmail } from "@/modules/email/process-inbound";
import { withApiLogging } from "@/modules/observability/api";

function isInboundAuthorized(request: Request) {
  if (!serverEnv.INBOUND_EMAIL_WEBHOOK_SECRET) {
    return true;
  }

  const token = request.headers.get("x-relaydesk-email-secret")?.trim();
  return token === serverEnv.INBOUND_EMAIL_WEBHOOK_SECRET;
}

async function POSTHandler(request: Request) {
  try {
    if (!isInboundAuthorized(request)) {
      chatLog("warn", "email_inbound_unauthorized");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await request.json().catch(() => null);
    const result = await processInboundEmail(payload);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true, conversationId: result.conversationId });
  } catch (error) {
    chatLog("error", "email_inbound_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiLogging(POSTHandler, "POST src/app/api/email/inbound");
