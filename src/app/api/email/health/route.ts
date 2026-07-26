import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";
import { getSessionClaims } from "@/modules/auth/session";
import { isSmtpConfigured } from "@/modules/email/smtp";
import { withApiLogging } from "@/modules/observability/api";

async function GETHandler() {
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const smtpReady = isSmtpConfigured();
  const inboundSecretReady = Boolean(serverEnv.INBOUND_EMAIL_WEBHOOK_SECRET);
  const inboundDomainReady = Boolean(serverEnv.INBOUND_EMAIL_DOMAIN);

  return NextResponse.json({
    smtpReady,
    inboundSecretReady,
    inboundDomainReady,
    checks: {
      smtpHost: Boolean(serverEnv.SMTP_HOST),
      smtpPort: Boolean(serverEnv.SMTP_PORT),
      smtpUser: Boolean(serverEnv.SMTP_USER),
      smtpPass: Boolean(serverEnv.SMTP_PASS),
      smtpFromEmail: Boolean(serverEnv.SMTP_FROM_EMAIL),
      smtpFromName: Boolean(serverEnv.SMTP_FROM_NAME),
      inboundWebhookSecret: inboundSecretReady,
      inboundDomain: inboundDomainReady,
    },
    status: smtpReady && inboundSecretReady ? "ready" : "partial",
  });
}

export const GET = withApiLogging(GETHandler, "GET src/app/api/email/health");
