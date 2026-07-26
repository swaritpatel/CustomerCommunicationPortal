import { NextResponse } from "next/server";

import { getSessionClaims } from "@/modules/auth/session";
import { syncGmailInbox } from "@/modules/email/gmail";

export async function POST() {
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncGmailInbox({
      workspaceId: claims.workspaceId,
      workspaceSlug: claims.workspaceSlug,
      maxResults: 20,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gmail sync failed" },
      { status: 500 },
    );
  }
}
