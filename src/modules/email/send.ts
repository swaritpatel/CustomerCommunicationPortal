import { sendSupportEmail } from "@/modules/email/smtp";

export async function sendWorkspaceSupportEmail(input: {
  workspaceId: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string | null;
  references?: string[];
}) {
  const result = await sendSupportEmail(input);
  return {
    ...result,
    transport: "smtp" as const,
  };
}
