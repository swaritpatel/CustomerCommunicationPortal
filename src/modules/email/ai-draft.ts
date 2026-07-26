type DraftInput = {
  subject: string;
  customerName?: string | null;
  recentMessages: Array<{ senderType: "VISITOR" | "AGENT" | "SYSTEM"; body: string }>;
  cannedResponses: string[];
};

export function buildAutoReplyDraft(input: DraftInput) {
  const greetingName = input.customerName?.trim() || "there";
  const subjectLine = input.subject?.trim() || "your request";
  const cannedSnippet = input.cannedResponses[0]?.trim();

  const lines = [
    `Hi ${greetingName},`,
    "",
    `We have received your request about ${subjectLine}.`,
    cannedSnippet || "Our support team is reviewing it now and will get back to you with the next steps shortly.",
    "",
    "Best,",
    "CCP Support",
  ];

  return lines.join("\n");
}
