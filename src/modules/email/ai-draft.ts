import { serverEnv } from "@/lib/env";
import { chatLog } from "@/modules/chat/log";

type DraftInput = {
  subject: string;
  customerName?: string | null;
  recentMessages: Array<{ senderType: "VISITOR" | "AGENT" | "SYSTEM"; body: string }>;
  cannedResponses: string[];
  suggestedArticles?: Array<{ title: string; excerpt: string | null; href: string }>;
};

type AcknowledgementInput = {
  subject: string;
  customerName?: string | null;
  customerMessage: string;
  conversationId?: string;
  workspaceId?: string;
};

function extractAssistantReply(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const first = choices[0] as { message?: { content?: unknown } };
  const content = first.message?.content;
  if (typeof content !== "string") {
    return null;
  }

  const reply = content.trim();
  return reply.length > 0 ? reply : null;
}

function normalizeAcknowledgementText(text: string) {
  return text
    .replace(/^subject:\s*.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isUsableAcknowledgement(text: string) {
  if (!text) {
    return false;
  }

  if (text.length > 1200) {
    return false;
  }

  if (/password|otp|one[-\s]?time password|card number|cvv/i.test(text)) {
    return false;
  }

  return true;
}

export async function generateEmailAcknowledgement(input: AcknowledgementInput) {
  if (serverEnv.AI_CHAT_MODE === "off") {
    return null;
  }

  if (!serverEnv.AI_API_KEY) {
    return null;
  }

  const model = serverEnv.AI_MODEL || "gpt-4o-mini";
  const baseUrl = (serverEnv.AI_BASE_URL || "https://api.openai.com").replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${serverEnv.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: serverEnv.AI_TEMPERATURE ?? 0.45,
        max_tokens: Math.min(serverEnv.AI_MAX_TOKENS ?? 220, 320),
        messages: [
          {
            role: "system",
            content: [
              "You write first-response acknowledgement emails for Cosmofeed Support.",
              "Sound natural, concise, professional, and human.",
              "Use the customer message context, but do not quote or repeat the message or subject line.",
              "Do not promise refunds, credits, exact timelines, or completed actions.",
              "Do not ask for passwords, OTPs, card details, or sensitive information.",
              "Ask at most one simple follow-up question only if it is truly useful.",
              "Return plain text only, under 90 words, signed as Cosmofeed Support.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Customer name: ${input.customerName?.trim() || "there"}`,
              `Email subject: ${input.subject.trim() || "(No subject)"}`,
              "",
              "Customer message:",
              input.customerMessage.trim().slice(0, 4000) || "(No body text)",
              "",
              "Write the acknowledgement email.",
            ].join("\n"),
          },
        ],
      }),
    });

    if (!response.ok) {
      chatLog("warn", "email_ack_ai_request_failed", {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        status: response.status,
      });
      return null;
    }

    const reply = extractAssistantReply(await response.json().catch(() => null));
    const normalized = reply ? normalizeAcknowledgementText(reply) : "";

    if (!isUsableAcknowledgement(normalized)) {
      chatLog("warn", "email_ack_ai_unusable_reply", {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        model,
        replyLength: normalized.length,
      });
      return null;
    }

    return {
      text: normalized,
      model,
    };
  } catch (error) {
    chatLog("warn", "email_ack_ai_exception", {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildAutoReplyDraft(input: DraftInput) {
  const greetingName = input.customerName?.trim() || "there";
  const cannedSnippet =
    input.cannedResponses.find((response) => !/received your request/i.test(response))?.trim();

  const lines = [
    `Hi ${greetingName},`,
    "",
    "Thank you for contacting Cosmofeed Support.",
    "",
    "We have received your message and our support team is reviewing the details.",
    "We will follow up on this email thread with the next update as soon as possible.",
    ...(input.suggestedArticles && input.suggestedArticles.length > 0
      ? [
          "",
          "In the meantime, these help articles may be useful:",
          ...input.suggestedArticles.map((article) => `- ${article.title}: ${article.href}`),
        ]
      : []),
    ...(cannedSnippet ? ["", cannedSnippet] : []),
    "",
    "Best,",
    "Cosmofeed Support",
  ];

  return lines.join("\n");
}
