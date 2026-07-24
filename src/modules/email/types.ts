export type NormalizedInboundEmail = {
  workspaceSlug?: string;
  recipient?: string;
  senderEmail: string;
  senderName: string | null;
  subject: string;
  textBody: string;
  htmlBody: string | null;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
};

export type ParsedMailbox = {
  name: string | null;
  email: string;
};
