import { db } from "@/lib/db";
import { generatePolicyAwareReply } from "@/modules/chat/agent-reply";
import { chatLog } from "@/modules/chat/log";
import { findRelevantSupportPolicies } from "@/modules/policies/support-policies";

type RecentChatMessage = {
  senderType: "VISITOR" | "AGENT" | "SYSTEM";
  body: string;
  senderUser: { fullName: string } | null;
};

export async function runAutoReplyWorkflow(input: {
  conversationId: string;
  workspaceId: string;
  workspaceName: string;
  latestVisitorText: string;
}) {
  await db.chatTypingState.deleteMany({
    where: {
      conversationId: input.conversationId,
      actorType: "AGENT",
      actorUserId: null,
    },
  });

  await db.chatTypingState.create({
    data: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      actorType: "AGENT",
      actorUserId: null,
    },
  });

  try {
    const recentMessages: RecentChatMessage[] = await db.chatMessage.findMany({
      where: { conversationId: input.conversationId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        senderType: true,
        body: true,
        senderUser: {
          select: { fullName: true },
        },
      },
    });
    const supportPolicies = await findRelevantSupportPolicies({
      workspaceId: input.workspaceId,
      text: input.latestVisitorText,
    });

    const aiReply = await generatePolicyAwareReply({
      workspaceName: input.workspaceName,
      latestVisitorMessage: input.latestVisitorText,
      supportPolicies,
      recentMessages: recentMessages.reverse().map((message: RecentChatMessage) => ({
        senderType: message.senderType,
        body: message.body,
        senderName: message.senderUser?.fullName,
      })),
    });

    if (aiReply.kind === "handoff") {
      chatLog("info", "ai_reply_handoff", {
        conversationId: input.conversationId,
        reason: aiReply.reason,
      });
      return;
    }

    if (aiReply.kind !== "reply") {
      chatLog("info", "ai_reply_skipped", {
        conversationId: input.conversationId,
        reason: aiReply.reason,
      });
      return;
    }

    const now = new Date();
    await db.$transaction([
      db.chatMessage.updateMany({
        where: {
          conversationId: input.conversationId,
          senderType: "VISITOR",
          readByAgentAt: null,
        },
        data: { readByAgentAt: now },
      }),
      db.chatMessage.create({
        data: {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          senderType: "AGENT",
          senderUserId: null,
          body: aiReply.body,
          readByVisitorAt: null,
          readByAgentAt: now,
        },
      }),
      db.conversation.update({
        where: { id: input.conversationId },
        data: {
          updatedAt: now,
          status: aiReply.shouldResolve ? "RESOLVED" : undefined,
        },
      }),
    ]);

    chatLog("info", "ai_reply_sent", {
      conversationId: input.conversationId,
      model: aiReply.model,
      policyIds: aiReply.policyIds,
      autoResolved: aiReply.shouldResolve,
    });
  } catch (error) {
    chatLog("warn", "ai_reply_workflow_failed", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    throw error;
  } finally {
    await db.chatTypingState.deleteMany({
      where: {
        conversationId: input.conversationId,
        actorType: "AGENT",
        actorUserId: null,
      },
    });
  }
}
