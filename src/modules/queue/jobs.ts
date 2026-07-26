export type RealtimeJob = {
  kind: "realtime.broadcast";
  type: "message.created" | "typing.updated" | "conversation.updated";
  workspaceId: string;
  conversationId: string;
};

export type EmailWebhookJob = {
  kind: "email.webhook";
  event: {
    type:
      | "email.inbound.received"
      | "email.reply.sent"
      | "email.sla.first_response_breached"
      | "email.sla.resolution_breached";
    workspaceId: string;
    conversationId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  };
};

export type EmailSendJob = {
  kind: "email.send";
  workspaceId: string;
  conversationId: string;
  customerEmail: string;
  subject: string;
  text: string;
  inReplyTo: string | null;
  references: string[];
  agentUserId?: string;
  webhookOccurredAt: string;
};

export type AiAutoReplyJob = {
  kind: "ai.autoReply";
  conversationId: string;
  workspaceId: string;
  workspaceName: string;
  latestVisitorText: string;
};

export type CcpJob = RealtimeJob | EmailWebhookJob | EmailSendJob | AiAutoReplyJob;

export const CCP_QUEUE_NAME = "ccp-background-jobs";
