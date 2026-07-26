import { serverEnv } from "@/lib/env";
import {
  buildPolicySystemPrompt,
  getAgentPolicy,
  shouldEscalateByPolicy,
} from "@/modules/chat/agent-policy";
import { chatLog } from "@/modules/chat/log";
import {
  formatPoliciesForPrompt,
  type MatchedSupportPolicy,
} from "@/modules/policies/support-policies";

type ConversationMessage = {
  senderType: "VISITOR" | "AGENT" | "SYSTEM";
  body: string;
  senderName?: string | null;
};

type GenerateReplyInput = {
  workspaceName?: string | null;
  latestVisitorMessage: string;
  recentMessages: ConversationMessage[];
  supportPolicies?: MatchedSupportPolicy[];
};

type ReplyDecision = {
  body: string;
  shouldResolve: boolean;
  policyIds: string[];
};

type ProviderAttempt = {
  provider: string;
  model: string;
  run: () => Promise<unknown>;
};

export type GenerateReplyResult =
  | {
      kind: "skip";
      reason: string;
    }
  | {
      kind: "handoff";
      reason: string;
    }
  | {
      kind: "reply";
      body: string;
      model: string;
      shouldResolve: boolean;
      policyIds: string[];
    };

function asTranscript(messages: ConversationMessage[]) {
  return messages
    .map((message) => {
      const sender =
        message.senderType === "VISITOR"
          ? "Customer"
          : message.senderName?.trim() || "Agent";
      return `${sender}: ${message.body.trim()}`;
    })
    .join("\n");
}

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

function extractGeminiReply(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const first = candidates[0] as { content?: { parts?: unknown } };
  const parts = first.content?.parts;
  if (!Array.isArray(parts)) {
    return null;
  }

  const reply = parts
    .map((part) => {
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("")
    .trim();

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

function extractReplyDecisionFromContent(content: string | null): ReplyDecision | null {
  if (!content) {
    return null;
  }

  const parsed = parseJsonObject(content);
  if (!parsed || typeof parsed !== "object") {
    return {
      body: content,
      shouldResolve: false,
      policyIds: [] as string[],
    };
  }

  const record = parsed as {
    reply?: unknown;
    shouldResolve?: unknown;
    policyIds?: unknown;
  };

  if (typeof record.reply !== "string" || !record.reply.trim()) {
    return null;
  }

  return {
    body: record.reply.trim(),
    shouldResolve: record.shouldResolve === true,
    policyIds: Array.isArray(record.policyIds)
      ? record.policyIds.filter((item): item is string => typeof item === "string").slice(0, 5)
      : [],
  };
}

function extractOpenAiReplyDecision(payload: unknown) {
  return extractReplyDecisionFromContent(extractAssistantReply(payload));
}

function extractGeminiReplyDecision(payload: unknown) {
  return extractReplyDecisionFromContent(extractGeminiReply(payload));
}

async function callOpenAiCompatibleProvider(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}) {
  const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      temperature: serverEnv.AI_TEMPERATURE ?? 0.6,
      max_tokens: serverEnv.AI_MAX_TOKENS ?? 280,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`provider_status_${response.status}`);
  }

  return response.json().catch(() => null) as Promise<unknown>;
}

async function callGeminiProvider(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      input.model,
    )}:generateContent?key=${encodeURIComponent(input.apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: input.systemPrompt }],
        },
        generationConfig: {
          temperature: serverEnv.AI_TEMPERATURE ?? 0.6,
          maxOutputTokens: serverEnv.AI_MAX_TOKENS ?? 280,
          responseMimeType: "application/json",
        },
        contents: [
          {
            role: "user",
            parts: [{ text: input.userPrompt }],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`provider_status_${response.status}`);
  }

  return response.json().catch(() => null) as Promise<unknown>;
}

function parseGroqKeys() {
  return (serverEnv.GROQ_API_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

export async function generatePolicyAwareReply(input: GenerateReplyInput): Promise<GenerateReplyResult> {
  if (serverEnv.AI_CHAT_MODE !== "autoreply") {
    return { kind: "skip", reason: "ai_chat_mode_not_autoreply" };
  }

  const policy = getAgentPolicy(serverEnv.AI_POLICY_NAME);
  const supportPolicies = input.supportPolicies ?? [];
  const escalation = shouldEscalateByPolicy(policy, input.latestVisitorMessage);
  if (escalation.shouldEscalate && supportPolicies.length === 0) {
    return {
      kind: "handoff",
      reason: escalation.reason ?? "policy_escalation_triggered",
    };
  }

  const systemPrompt = [
    buildPolicySystemPrompt(policy),
    "",
    "Workspace support policies:",
    formatPoliciesForPrompt(supportPolicies),
    "",
    "When support policies are relevant, use them as the source of truth.",
    "Always produce a helpful customer-facing reply. If the issue cannot be safely resolved automatically, acknowledge it and say the support team will review it.",
    "Do not copy the customer message back to them.",
    "Return only valid JSON with keys: reply, shouldResolve, policyIds.",
    "shouldResolve can be true only when a relevant policy explicitly allows auto-resolve and the reply fully answers the customer's request.",
  ].join("\n");
  const transcript = asTranscript(input.recentMessages.slice(-20));
  const autoResolvablePolicyIds = new Set(
    supportPolicies.filter((item) => item.autoResolveEnabled).map((item) => item.id),
  );

  const userPrompt = [
    `Workspace: ${input.workspaceName?.trim() || "CCP Workspace"}`,
    `Current date/time: ${new Date().toISOString()}`,
    "",
    "Recent transcript:",
    transcript || "(No prior messages)",
    "",
    `Latest customer message: ${input.latestVisitorMessage.trim()}`,
    "",
    "Write the next best support response now.",
  ].join("\n");

  const attempts: ProviderAttempt[] = [];

  if (serverEnv.AI_API_KEY) {
    const model = serverEnv.AI_MODEL || "gpt-4o-mini";
    attempts.push({
      provider: serverEnv.AI_PROVIDER || "openai",
      model,
      run: () =>
        callOpenAiCompatibleProvider({
          baseUrl: serverEnv.AI_BASE_URL || "https://api.openai.com",
          apiKey: serverEnv.AI_API_KEY!,
          model,
          systemPrompt,
          userPrompt,
        }),
    });
  }

  if (serverEnv.GEMINI_API_KEY) {
    const model = serverEnv.GEMINI_MODEL || "gemini-1.5-flash";
    attempts.push({
      provider: "gemini",
      model,
      run: () =>
        callGeminiProvider({
          apiKey: serverEnv.GEMINI_API_KEY!,
          model,
          systemPrompt,
          userPrompt,
        }),
    });
  }

  const groqModel = serverEnv.GROQ_MODEL || "llama-3.1-8b-instant";
  parseGroqKeys().forEach((apiKey, index) => {
    attempts.push({
      provider: `groq_${index + 1}`,
      model: groqModel,
      run: () =>
        callOpenAiCompatibleProvider({
          baseUrl: "https://api.groq.com/openai",
          apiKey,
          model: groqModel,
          systemPrompt,
          userPrompt,
        }),
    });
  });

  if (attempts.length === 0) {
    return { kind: "skip", reason: "ai_provider_keys_missing" };
  }

  for (const attempt of attempts) {
    try {
      const payload = await attempt.run();
      const decision =
        attempt.provider === "gemini"
          ? extractGeminiReplyDecision(payload)
          : extractOpenAiReplyDecision(payload);

      if (!decision) {
        chatLog("warn", "ai_reply_empty_from_provider", {
          provider: attempt.provider,
          model: attempt.model,
        });
        continue;
      }

      if (decision.body.toUpperCase() === "HANDOFF_REQUIRED") {
        return { kind: "handoff", reason: `model_requested_handoff_${attempt.provider}` };
      }

      chatLog("info", "ai_reply_provider_succeeded", {
        provider: attempt.provider,
        model: attempt.model,
      });

      return {
        kind: "reply",
        body: decision.body,
        model: `${attempt.provider}:${attempt.model}`,
        shouldResolve:
          decision.shouldResolve &&
          decision.policyIds.some((policyId) => autoResolvablePolicyIds.has(policyId)),
        policyIds: decision.policyIds,
      };
    } catch (error) {
      chatLog("warn", "ai_reply_provider_failed", {
        provider: attempt.provider,
        model: attempt.model,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  return { kind: "skip", reason: "all_ai_providers_failed" };
}
