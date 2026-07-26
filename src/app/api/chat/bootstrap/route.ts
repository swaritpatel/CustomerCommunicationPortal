import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { issueVisitorToken } from "@/modules/chat/auth";
import { chatLog } from "@/modules/chat/log";
import { withApiLogging } from "@/modules/observability/api";

async function POSTHandler(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          workspaceSlug?: string;
          customerKey?: string;
          customerName?: string;
          customerEmail?: string;
        }
      | null;

    if (!body?.workspaceSlug) {
      chatLog("warn", "bootstrap_missing_workspace_slug");
      return NextResponse.json({ error: "workspaceSlug is required" }, { status: 400 });
    }

    const workspace = await db.workspace.findUnique({
      where: { slug: body.workspaceSlug },
      select: { id: true, name: true },
    });

    if (!workspace) {
      chatLog("warn", "bootstrap_workspace_not_found", { workspaceSlug: body.workspaceSlug });
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const customerKey = body.customerKey?.trim() || randomUUID();
    const now = new Date();

    const existingConversation = await db.conversation.findFirst({
      where: {
        workspaceId: workspace.id,
        channel: "CHAT_WIDGET",
        customerKey,
        status: { not: "RESOLVED" },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });

    const conversation =
      existingConversation ??
      (await db.conversation.create({
        data: {
          workspaceId: workspace.id,
          channel: "CHAT_WIDGET",
          subject: `${body.customerName?.trim() || "Website visitor"} · Live chat`,
          customerKey,
          customerName: body.customerName?.trim() || null,
          customerEmail: body.customerEmail?.trim() || null,
          visitorLastSeenAt: now,
        },
        select: { id: true },
      }));

    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        visitorLastSeenAt: now,
        customerName: body.customerName?.trim() || undefined,
        customerEmail: body.customerEmail?.trim() || undefined,
      },
    });

    const visitorToken = await issueVisitorToken({
      workspaceId: workspace.id,
      conversationId: conversation.id,
      customerKey,
    });

    const [messages, onlineAgents] = await Promise.all([
      db.chatMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "asc" },
        take: 100,
        select: {
          id: true,
          senderType: true,
          senderUserId: true,
          body: true,
          createdAt: true,
          readByVisitorAt: true,
          readByAgentAt: true,
        },
      }),
      db.workspaceMember.count({
        where: {
          workspaceId: workspace.id,
          status: "ACTIVE",
          lastSeenAt: { gte: new Date(Date.now() - 45_000) },
        },
      }),
    ]);

    return NextResponse.json({
      workspace: { id: workspace.id, name: workspace.name, slug: body.workspaceSlug },
      conversationId: conversation.id,
      customerKey,
      visitorToken,
      agentOnline: onlineAgents > 0,
      messages,
    });
  } catch (error) {
    chatLog("error", "bootstrap_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withApiLogging(POSTHandler, "POST src/app/api/chat/bootstrap");
