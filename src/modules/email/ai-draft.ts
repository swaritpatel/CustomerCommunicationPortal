type DraftInput = {
  subject: string;
  customerName?: string | null;
  recentMessages: Array<{ senderType: "VISITOR" | "AGENT" | "SYSTEM"; body: string }>;
  cannedResponses: string[];
};

function sanitizeLine(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function buildAutoReplyDraft(input: DraftInput) {
  const latestVisitorMessage = [...input.recentMessages]
    .reverse()
    .find((message) => message.senderType === "VISITOR");

  const greetingName = input.customerName?.trim() || "there";
  const subjectLine = input.subject?.trim() || "your request";
  const visitorExcerpt = sanitizeLine(latestVisitorMessage?.body || "").slice(0, 240);
  const cannedSnippet = input.cannedResponses[0]?.trim();

  const lines = [
    `Hi ${greetingName},`,
    "",
    `Thanks for reaching out about ${subjectLine}.`,
    visitorExcerpt ? `I reviewed your message: \"${visitorExcerpt}\".` : "I reviewed your message.",
    cannedSnippet || "I am checking this with the team and will share the next steps shortly.",
    "",
    "Best,",
    "CCP Support",
  ];

  return lines.join("\n");
}