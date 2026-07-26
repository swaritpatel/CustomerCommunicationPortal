import { SignJWT } from "jose";
import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";
import { getSessionClaims } from "@/modules/auth/session";
import { buildGoogleAuthUrl, isGmailConfigured } from "@/modules/email/gmail";

const stateSecret = new TextEncoder().encode(serverEnv.JWT_ACCESS_SECRET);

export async function GET() {
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGmailConfigured()) {
    return NextResponse.json({ error: "Gmail OAuth is not configured" }, { status: 503 });
  }

  const state = await new SignJWT({
    workspaceId: claims.workspaceId,
    workspaceSlug: claims.workspaceSlug,
    userId: claims.sub,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(stateSecret);

  return NextResponse.redirect(buildGoogleAuthUrl(state));
}
