import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { withApiLogging } from "@/modules/observability/api";

function normalizeHostname(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

function isValidHostname(value: string) {
  if (value.length < 4 || value.length > 253 || value.includes("..")) {
    return false;
  }

  const labels = value.split(".");
  return (
    labels.length >= 2 &&
    labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}

async function requireKbMember() {
  const claims = await getSessionClaims();
  if (!claims) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const membership = await db.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: claims.workspaceId,
        userId: claims.sub,
      },
    },
    select: { id: true, status: true },
  });

  if (!membership || membership.status !== "ACTIVE") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { claims };
}

async function GETHandler() {
  try {
    const auth = await requireKbMember();
    if (auth.error) {
      return auth.error;
    }

    const domains = await db.knowledgeBaseDomain.findMany({
      where: { workspaceId: auth.claims.workspaceId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        hostname: true,
        status: true,
        sslStatus: true,
        verificationToken: true,
        verifiedAt: true,
        lastCheckedAt: true,
        failureReason: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ domains });
  } catch (error) {
    chatLog("error", "kb_domain_get_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function POSTHandler(request: Request) {
  try {
    const auth = await requireKbMember();
    if (auth.error) {
      return auth.error;
    }

    const body = (await request.json().catch(() => null)) as
      | {
          action?: string;
          hostname?: string;
          domainId?: string;
          dnsTxtValue?: string;
        }
      | null;

    if (body?.action === "connectDomain") {
      const hostname = normalizeHostname(body.hostname ?? "");
      if (!isValidHostname(hostname)) {
        return NextResponse.json({ error: "Enter a valid hostname like help.example.com" }, { status: 400 });
      }

      const existing = await db.knowledgeBaseDomain.findUnique({
        where: { hostname },
        select: { id: true, workspaceId: true },
      });

      if (existing && existing.workspaceId !== auth.claims.workspaceId) {
        return NextResponse.json({ error: "This domain is already connected to another workspace" }, { status: 409 });
      }

      const token = `ccp-domain-verify=${crypto.randomUUID()}`;
      const domain = existing
        ? await db.knowledgeBaseDomain.update({
            where: { id: existing.id },
            data: {
              verificationToken: token,
              status: "PENDING",
              sslStatus: "PENDING",
              verifiedAt: null,
              failureReason: null,
            },
          })
        : await db.knowledgeBaseDomain.create({
            data: {
              workspaceId: auth.claims.workspaceId,
              hostname,
              verificationToken: token,
            },
          });

      return NextResponse.json({ ok: true, domain });
    }

    if (body?.action === "verifyDomain") {
      const domain = await db.knowledgeBaseDomain.findUnique({
        where: { id: body.domainId ?? "" },
      });

      if (!domain || domain.workspaceId !== auth.claims.workspaceId) {
        return NextResponse.json({ error: "Domain not found" }, { status: 404 });
      }

      const providedTxt = body.dnsTxtValue?.trim();
      if (providedTxt !== domain.verificationToken) {
        const updated = await db.knowledgeBaseDomain.update({
          where: { id: domain.id },
          data: {
            status: "FAILED",
            failureReason: "DNS TXT value did not match the expected verification token.",
            lastCheckedAt: new Date(),
          },
        });
        return NextResponse.json({ ok: false, domain: updated }, { status: 400 });
      }

      const updated = await db.knowledgeBaseDomain.update({
        where: { id: domain.id },
        data: {
          status: "VERIFIED",
          sslStatus: "ACTIVE",
          verifiedAt: new Date(),
          lastCheckedAt: new Date(),
          failureReason: null,
        },
      });

      return NextResponse.json({
        ok: true,
        domain: updated,
        note: "DNS verification is stubbed by matching the TXT token. In production this endpoint would query authoritative DNS, then enqueue SSL provisioning.",
      });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    chatLog("error", "kb_domain_post_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const GET = withApiLogging(GETHandler, "GET src/app/api/kb/domain");
export const POST = withApiLogging(POSTHandler, "POST src/app/api/kb/domain");
