import { serverEnv } from "@/lib/env";
import { chatLog } from "@/modules/chat/log";
import {
  formatPoliciesForPrompt,
  type MatchedSupportPolicy,
} from "@/modules/policies/support-policies";

type DraftInput = {
  subject: string;
  customerName?: string | null;
  recentMessages: Array<{ senderType: "VISITOR" | "AGENT" | "SYSTEM"; body: string }>;
  cannedResponses: string[];
  supportPolicies?: MatchedSupportPolicy[];
  suggestedArticles?: Array<{ title: string; excerpt: string | null; href: string }>;
};

type AcknowledgementInput = {
  subject: string;
  customerName?: string | null;
  customerMessage: string;
  policies?: MatchedSupportPolicy[];
  conversationId?: string;
  workspaceId?: string;
};

function extractAssistantContent(payload: unknown) {
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

function parseJsonObject(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
}

function extractAcknowledgementDecision(payload: unknown) {
  const content = extractAssistantContent(payload);
  if (!content) {
    return null;
  }

  const parsed = parseJsonObject(content);
  if (!parsed || typeof parsed !== "object") {
    return {
      text: content,
      shouldResolve: false,
      policyIds: [] as string[],
    };
  }

  const record = parsed as {
    reply?: unknown;
    shouldResolve?: unknown;
    policyIds?: unknown;
  };

  if (typeof record.reply !== "string") {
    return null;
  }

  return {
    text: record.reply,
    shouldResolve: record.shouldResolve === true,
    policyIds: Array.isArray(record.policyIds)
      ? record.policyIds.filter((item): item is string => typeof item === "string").slice(0, 5)
      : [],
  };
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
  const policies = input.policies ?? [];
  const autoResolvablePolicyIds = new Set(
    policies.filter((policy) => policy.autoResolveEnabled).map((policy) => policy.id),
  );

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
              "You write first-response support emails for Cosmofeed Support.",
              "Sound natural, concise, professional, and human.",
              "Use the customer message context, but do not quote or repeat the message or subject line.",
              "Use workspace support policies as the source of truth when they are relevant.",
              "Do not promise refunds, credits, exact timelines, or completed actions.",
              "Do not ask for passwords, OTPs, card details, or sensitive information.",
              "Ask at most one simple follow-up question only if policy requires it.",
              "Return only valid JSON with keys: reply, shouldResolve, policyIds.",
              "reply must be plain text under 120 words and signed as Cosmofeed Support.",
              "shouldResolve can be true only when a relevant policy explicitly allows auto-resolve and the reply fully answers the customer's request.",
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
              "Workspace support policies:",
              formatPoliciesForPrompt(policies),
              "",
              "Write the policy-aware email response now.",
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

    const decision = extractAcknowledgementDecision(await response.json().catch(() => null));
    const normalized = decision ? normalizeAcknowledgementText(decision.text) : "";

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
      shouldResolve:
        Boolean(decision?.shouldResolve) &&
        decision.policyIds.some((policyId) => autoResolvablePolicyIds.has(policyId)),
      policyIds: decision?.policyIds ?? [],
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
  const policy = input.supportPolicies?.[0];

  const lines = [
    `Hi ${greetingName},`,
    "",
    "Thank you for contacting Cosmofeed Support.",
    "",
    ...(policy
      ? [
          policy.publicGuidance,
          "",
          policy.autoResolveEnabled
            ? "If anything still looks unclear, please reply on this thread and we will review it further."
            : "Our support team is reviewing the details and will follow up with the next update as soon as possible.",
        ]
      : [
          "We have received your message and our support team is reviewing the details.",
          "We will follow up on this email thread with the next update as soon as possible.",
        ]),
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
