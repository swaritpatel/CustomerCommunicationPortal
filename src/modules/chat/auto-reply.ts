import { db } from "@/lib/db";
import { generatePolicyAwareReply } from "@/modules/chat/agent-reply";
import { chatLog } from "@/modules/chat/log";
import { findRelevantSupportPolicies } from "@/modules/policies/support-policies";

type RecentChatMessage = {
  senderType: "VISITOR" | "AGENT" | "SYSTEM";
  body: string;
  senderUser: { fullName: string } | null;
};

function buildFallbackReply(ticketNumber: string | null) {
  return [
    "Thanks for sharing this with us.",
    "",
    "I could not fully resolve this automatically, so I am keeping this ticket open for our support team to review. We will follow up here with the next update.",
    ticketNumber
      ? [
          "",
          `Ticket number: ${ticketNumber}`,
          "Please keep this ticket number for future reference.",
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function withTicketReference(body: string, ticketNumber: string | null, shouldInclude: boolean) {
  if (!ticketNumber || !shouldInclude || body.includes(ticketNumber)) {
    return body;
  }

  return [
    body.trim(),
    "",
    `Ticket number: ${ticketNumber}`,
    "Please keep this ticket number for future reference.",
  ].join("\n");
}

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
    const [conversation, recentMessages]: [
      { ticketNumber: string | null } | null,
      RecentChatMessage[],
    ] = await Promise.all([
      db.conversation.findUnique({
        where: { id: input.conversationId },
        select: { ticketNumber: true },
      }),
      db.chatMessage.findMany({
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
      }),
    ]);

    const priorSupportReplyCount = recentMessages.filter(
      (message) => message.senderType === "AGENT" || message.senderType === "SYSTEM",
    ).length;
    const shouldIncludeTicket = priorSupportReplyCount === 0;

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
    }

    if (aiReply.kind !== "reply") {
      chatLog("info", "ai_reply_skipped", {
        conversationId: input.conversationId,
        reason: aiReply.reason,
      });
    }

    const replyBody =
      aiReply.kind === "reply"
        ? withTicketReference(aiReply.body, conversation?.ticketNumber ?? null, shouldIncludeTicket)
        : buildFallbackReply(conversation?.ticketNumber ?? null);

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
          body: replyBody,
          readByVisitorAt: null,
          readByAgentAt: now,
        },
      }),
      db.conversation.update({
        where: { id: input.conversationId },
        data: {
          updatedAt: now,
          status: aiReply.kind === "reply" && aiReply.shouldResolve ? "RESOLVED" : "OPEN",
        },
      }),
    ]);

    chatLog("info", "ai_reply_sent", {
      conversationId: input.conversationId,
      model: aiReply.kind === "reply" ? aiReply.model : "fallback",
      policyIds: aiReply.kind === "reply" ? aiReply.policyIds : [],
      autoResolved: aiReply.kind === "reply" ? aiReply.shouldResolve : false,
      fallback: aiReply.kind !== "reply",
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
