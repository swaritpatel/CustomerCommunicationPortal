type DraftInput = {
  subject: string;
  customerName?: string | null;
  recentMessages: Array<{ senderType: "VISITOR" | "AGENT" | "SYSTEM"; body: string }>;
  cannedResponses: string[];
};

export function buildAutoReplyDraft(input: DraftInput) {
  const greetingName = input.customerName?.trim() || "there";
  const subjectLine = input.subject?.trim() || "your request";
  const cannedSnippet =
    input.cannedResponses.find((response) => !/received your request/i.test(response))?.trim();

  const lines = [
    `Hi ${greetingName},`,
    "",
    "Thank you for contacting Cosmofeed Support.",
    "",
    `This is to confirm that we have received your request regarding \"${subjectLine}\".`,
    "",
    "Our support team is reviewing the details and will follow up with the next update as soon as possible.",
    ...(cannedSnippet ? ["", cannedSnippet] : []),
    "",
    "Best,",
    "Cosmofeed Support",
  ];

  return lines.join("\n");
}
