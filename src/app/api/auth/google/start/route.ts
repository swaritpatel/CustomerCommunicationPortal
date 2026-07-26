import { SignJWT } from "jose";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";
import { getSessionClaims } from "@/modules/auth/session";
import { buildGoogleAuthUrl, isGmailConfigured } from "@/modules/email/gmail";
import { withApiLogging } from "@/modules/observability/api";

const stateSecret = new TextEncoder().encode(serverEnv.JWT_ACCESS_SECRET);

async function GETHandler() {
  const claims = await getSessionClaims();
  if (!claims) {
    redirect("/login");
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

export const GET = withApiLogging(GETHandler, "GET src/app/api/auth/google/start");
