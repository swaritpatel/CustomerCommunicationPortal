import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { getSessionClaims } from "@/modules/auth/session";
import { isGmailConfigured } from "@/modules/email/gmail";
import { withApiLogging } from "@/modules/observability/api";

async function GETHandler() {
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const integration = await db.gmailIntegration.findFirst({
    where: {
      workspaceId: claims.workspaceId,
      ...(serverEnv.GMAIL_SUPPORT_EMAIL ? { email: serverEnv.GMAIL_SUPPORT_EMAIL } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      email: true,
      lastSyncedAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    configured: isGmailConfigured(),
    connected: Boolean(integration),
    email: integration?.email ?? serverEnv.GMAIL_SUPPORT_EMAIL ?? null,
    lastSyncedAt: integration?.lastSyncedAt ?? null,
    updatedAt: integration?.updatedAt ?? null,
  });
}

export const GET = withApiLogging(GETHandler, "GET src/app/api/email/gmail/status");
