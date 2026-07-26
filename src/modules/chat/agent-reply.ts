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

function extractReplyDecision(payload: unknown) {
  const content = extractAssistantReply(payload);
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

export async function generatePolicyAwareReply(input: GenerateReplyInput): Promise<GenerateReplyResult> {
  if (serverEnv.AI_CHAT_MODE !== "autoreply") {
    return { kind: "skip", reason: "ai_chat_mode_not_autoreply" };
  }

  if (!serverEnv.AI_API_KEY) {
    return { kind: "skip", reason: "ai_api_key_missing" };
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

  const model = serverEnv.AI_MODEL || "gpt-4o-mini";
  const baseUrl = (serverEnv.AI_BASE_URL || "https://api.openai.com").replace(/\/$/, "");
  const systemPrompt = [
    buildPolicySystemPrompt(policy),
    "",
    "Workspace support policies:",
    formatPoliciesForPrompt(supportPolicies),
    "",
    "When support policies are relevant, use them as the source of truth.",
    "Return only valid JSON with keys: reply, shouldResolve, policyIds.",
    "shouldResolve can be true only when a relevant policy explicitly allows auto-resolve and the reply fully answers the customer's request.",
  ].join("\n");
  const transcript = asTranscript(input.recentMessages.slice(-20));
  const autoResolvablePolicyIds = new Set(
    supportPolicies.filter((item) => item.autoResolveEnabled).map((item) => item.id),
  );

  const userPrompt = [
    `Workspace: ${input.workspaceName?.trim() || "CCP Workspace"}`,
    "",
    "Recent transcript:",
    transcript || "(No prior messages)",
    "",
    `Latest customer message: ${input.latestVisitorMessage.trim()}`,
    "",
    "Write the next best support response now.",
  ].join("\n");

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${serverEnv.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: serverEnv.AI_TEMPERATURE ?? 0.6,
        max_tokens: serverEnv.AI_MAX_TOKENS ?? 280,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      chatLog("warn", "ai_reply_request_failed", {
        status: response.status,
      });
      return { kind: "skip", reason: `ai_provider_status_${response.status}` };
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    const decision = extractReplyDecision(payload);

    if (!decision) {
      return { kind: "skip", reason: "ai_empty_reply" };
    }

    if (decision.body.toUpperCase() === "HANDOFF_REQUIRED") {
      return { kind: "handoff", reason: "model_requested_handoff" };
    }

    return {
      kind: "reply",
      body: decision.body,
      model,
      shouldResolve:
        decision.shouldResolve &&
        decision.policyIds.some((policyId) => autoResolvablePolicyIds.has(policyId)),
      policyIds: decision.policyIds,
    };
  } catch (error) {
    chatLog("warn", "ai_reply_exception", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return { kind: "skip", reason: "ai_request_exception" };
  }
}
