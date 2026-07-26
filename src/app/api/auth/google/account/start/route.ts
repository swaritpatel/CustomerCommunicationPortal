import { SignJWT } from "jose";
import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";
import { buildGoogleAccountAuthUrl, isGmailConfigured } from "@/modules/email/gmail";
import { withApiLogging } from "@/modules/observability/api";

const stateSecret = new TextEncoder().encode(serverEnv.JWT_ACCESS_SECRET);

function parseMode(value: string | null) {
  return value === "signup" ? "signup" : "login";
}

async function GETHandler(request: Request) {
  if (!isGmailConfigured()) {
    return NextResponse.json({ error: "Google OAuth is not configured" }, { status: 503 });
  }

  const url = new URL(request.url);
  const mode = parseMode(url.searchParams.get("mode"));
  const state = await new SignJWT({
    purpose: "account_auth",
    mode,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`google-account-${mode}`)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(stateSecret);

  return NextResponse.redirect(buildGoogleAccountAuthUrl(state));
}

export const GET = withApiLogging(GETHandler, "GET src/app/api/auth/google/account/start");
