import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import nodemailer from "nodemailer";
import pg from "pg";

const { Client } = pg;

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

async function detectBaseUrl() {
  const candidates = [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    "http://localhost:3000",
    "http://localhost:3001",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, { method: "GET" });
      if (res.ok) {
        return candidate;
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM_EMAIL,
  );
}

async function run() {
  const baseUrl = await detectBaseUrl();
  if (!baseUrl) {
    console.error("FAIL step 1: app URL not reachable. Start app with npm run dev.");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("FAIL step 2: DATABASE_URL missing in .env.local");
    process.exit(1);
  }

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const workspaceQuery = await db.query(
    'select slug from "Workspace" order by "createdAt" asc limit 1',
  );
  const workspaceSlug = workspaceQuery.rows?.[0]?.slug;
  if (!workspaceSlug) {
    console.error("FAIL step 3: no workspace found in database.");
    await db.end();
    process.exit(1);
  }

  const messageIdOne = `<verify-${randomUUID()}@${process.env.INBOUND_EMAIL_DOMAIN || "example.com"}>`;
  const messageIdTwo = `<verify-${randomUUID()}@${process.env.INBOUND_EMAIL_DOMAIN || "example.com"}>`;
  const authHeader = process.env.INBOUND_EMAIL_WEBHOOK_SECRET
    ? { "x-relaydesk-email-secret": process.env.INBOUND_EMAIL_WEBHOOK_SECRET }
    : {};

  const inboundOne = await fetch(`${baseUrl}/api/email/inbound`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeader,
    },
    body: JSON.stringify({
      workspaceSlug,
      from: "Customer Verify <verify@example.com>",
      subject: "Verification thread",
      text: "First inbound message",
      messageId: messageIdOne,
    }),
  });

  if (!inboundOne.ok) {
    const payload = await inboundOne.text();
    console.error(`FAIL step 4: first inbound failed (${inboundOne.status}) ${payload.slice(0, 220)}`);
    await db.end();
    process.exit(1);
  }

  const inboundOnePayload = await inboundOne.json();
  const firstConversationId = inboundOnePayload.conversationId;

  const inboundTwo = await fetch(`${baseUrl}/api/email/inbound`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeader,
    },
    body: JSON.stringify({
      workspaceSlug,
      from: "Customer Verify <verify@example.com>",
      subject: "Re: Verification thread",
      text: "Second inbound message",
      messageId: messageIdTwo,
      inReplyTo: messageIdOne,
      references: messageIdOne,
    }),
  });

  if (!inboundTwo.ok) {
    const payload = await inboundTwo.text();
    console.error(`FAIL step 5: second inbound failed (${inboundTwo.status}) ${payload.slice(0, 220)}`);
    await db.end();
    process.exit(1);
  }

  const inboundTwoPayload = await inboundTwo.json();
  const secondConversationId = inboundTwoPayload.conversationId;

  const threadPass = firstConversationId && secondConversationId && firstConversationId === secondConversationId;

  if (!threadPass) {
    console.error("FAIL step 6: threading failed. Replies did not stay in same conversation.");
    await db.end();
    process.exit(1);
  }

  console.log(`PASS inbound parsing + threading. conversationId=${firstConversationId}`);

  if (smtpConfigured()) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM_NAME
          ? `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`
          : process.env.SMTP_FROM_EMAIL,
        to: process.env.SMTP_FROM_EMAIL,
        subject: "[CCP Verify] SMTP outbound check",
        text: "CCP email channel verification ping.",
      });

      console.log("PASS SMTP outbound send check.");
    } catch (error) {
      console.error("FAIL SMTP outbound send check:", error instanceof Error ? error.message : String(error));
      await db.end();
      process.exit(1);
    }
  } else {
    console.log("SKIP SMTP outbound check: SMTP env vars not fully configured.");
  }

  await db.end();
  console.log("Email channel verification complete.");
}

run().catch(async (error) => {
  console.error("FAIL unexpected error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
