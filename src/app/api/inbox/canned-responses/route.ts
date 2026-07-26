import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";
import { chatLog } from "@/modules/chat/log";

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function requireActiveWorkspaceMember() {
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
    select: { status: true },
  });

  if (!membership || membership.status !== "ACTIVE") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { claims };
}

export async function GET() {
  try {
    const auth = await requireActiveWorkspaceMember();
    if ("error" in auth) {
      return auth.error;
    }

    const responses = await db.cannedResponse.findMany({
      where: { workspaceId: auth.claims.workspaceId },
      orderBy: [{ updatedAt: "desc" }, { tag: "asc" }],
      select: {
        id: true,
        tag: true,
        body: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ responses });
  } catch (error) {
    chatLog("error", "inbox_canned_responses_list_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireActiveWorkspaceMember();
    if ("error" in auth) {
      return auth.error;
    }

    const body = (await request.json().catch(() => null)) as
      | { tag?: string; body?: string }
      | null;
    const tag = body?.tag?.trim().slice(0, 48);
    const responseBody = body?.body?.trim().slice(0, 4_000);

    if (!tag || !responseBody) {
      return NextResponse.json({ error: "tag and body are required" }, { status: 400 });
    }

    const response = await db.cannedResponse.create({
      data: {
        workspaceId: auth.claims.workspaceId,
        createdById: auth.claims.sub,
        tag,
        body: responseBody,
      },
      select: {
        id: true,
        tag: true,
        body: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ response }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "A saved response with this tag already exists." }, { status: 409 });
    }

    chatLog("error", "inbox_canned_response_create_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireActiveWorkspaceMember();
    if ("error" in auth) {
      return auth.error;
    }

    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await db.cannedResponse.deleteMany({
      where: {
        id,
        workspaceId: auth.claims.workspaceId,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    chatLog("error", "inbox_canned_response_delete_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
