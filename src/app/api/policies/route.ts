import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";
import { withApiLogging } from "@/modules/observability/api";

function parseKeywords(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .slice(0, 24);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 24);
  }

  return [];
}

async function requirePolicyMember() {
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
    select: { id: true, role: true, status: true },
  });

  if (!membership || membership.status !== "ACTIVE") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { claims, membership };
}

async function GETHandler() {
  try {
    const auth = await requirePolicyMember();
    if (auth.error) {
      return auth.error;
    }

    const policies = await db.supportPolicy.findMany({
      where: { workspaceId: auth.claims.workspaceId },
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        category: true,
        keywords: true,
        publicGuidance: true,
        internalNotes: true,
        autoResolveEnabled: true,
        isActive: true,
        sortOrder: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ policies });
  } catch (error) {
    chatLog("error", "policies_get_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function POSTHandler(request: Request) {
  try {
    const auth = await requirePolicyMember();
    if (auth.error) {
      return auth.error;
    }

    if (auth.membership.role !== "ADMIN") {
      return NextResponse.json({ error: "Only admins can modify policies" }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          action?: string;
          id?: string;
          title?: string;
          category?: string;
          keywords?: string[] | string;
          publicGuidance?: string;
          internalNotes?: string | null;
          autoResolveEnabled?: boolean;
          isActive?: boolean;
          sortOrder?: number;
        }
      | null;

    if (!body?.action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    if (body.action === "archivePolicy") {
      if (!body.id) {
        return NextResponse.json({ error: "id is required" }, { status: 400 });
      }

      const policy = await db.supportPolicy.update({
        where: { id: body.id, workspaceId: auth.claims.workspaceId },
        data: { isActive: false },
      });

      return NextResponse.json({ ok: true, policy });
    }

    if (body.action === "savePolicy") {
      const title = body.title?.trim();
      const category = body.category?.trim() || "General";
      const publicGuidance = body.publicGuidance?.trim();

      if (!title || title.length < 3) {
        return NextResponse.json({ error: "Policy title is required" }, { status: 400 });
      }

      if (!publicGuidance || publicGuidance.length < 12) {
        return NextResponse.json({ error: "Customer guidance is required" }, { status: 400 });
      }

      const data = {
        title,
        category,
        keywords: parseKeywords(body.keywords),
        publicGuidance,
        internalNotes: body.internalNotes?.trim() || null,
        autoResolveEnabled: Boolean(body.autoResolveEnabled),
        isActive: body.isActive ?? true,
        sortOrder: Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0,
      };

      const policy = body.id
        ? await db.supportPolicy.update({
            where: { id: body.id, workspaceId: auth.claims.workspaceId },
            data,
          })
        : await db.supportPolicy.create({
            data: {
              workspaceId: auth.claims.workspaceId,
              createdById: auth.claims.sub,
              ...data,
            },
          });

      return NextResponse.json({ ok: true, policy });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    chatLog("error", "policies_post_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const GET = withApiLogging(GETHandler, "GET src/app/api/policies");
export const POST = withApiLogging(POSTHandler, "POST src/app/api/policies");
