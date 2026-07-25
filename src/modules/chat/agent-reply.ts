import { serverEnv } from "@/lib/env";
import {
  buildPolicySystemPrompt,
  getAgentPolicy,
  shouldEscalateByPolicy,
} from "@/modules/chat/agent-policy";
import { chatLog } from "@/modules/chat/log";

type ConversationMessage = {
  senderType: "VISITOR" | "AGENT" | "SYSTEM";
  body: string;
  senderName?: string | null;
};

type GenerateReplyInput = {
  workspaceName?: string | null;
  latestVisitorMessage: string;
  recentMessages: ConversationMessage[];
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

export async function generatePolicyAwareReply(input: GenerateReplyInput): Promise<GenerateReplyResult> {
  if (serverEnv.AI_CHAT_MODE !== "autoreply") {
    return { kind: "skip", reason: "ai_chat_mode_not_autoreply" };
  }

  if (!serverEnv.AI_API_KEY) {
    return { kind: "skip", reason: "ai_api_key_missing" };
  }

  const policy = getAgentPolicy(serverEnv.AI_POLICY_NAME);
  const escalation = shouldEscalateByPolicy(policy, input.latestVisitorMessage);
  if (escalation.shouldEscalate) {
    return {
      kind: "handoff",
      reason: escalation.reason ?? "policy_escalation_triggered",
    };
  }

  const model = serverEnv.AI_MODEL || "gpt-4o-mini";
  const baseUrl = (serverEnv.AI_BASE_URL || "https://api.openai.com").replace(/\/$/, "");
  const systemPrompt = buildPolicySystemPrompt(policy);
  const transcript = asTranscript(input.recentMessages.slice(-20));

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
    const reply = extractAssistantReply(payload);

    if (!reply) {
      return { kind: "skip", reason: "ai_empty_reply" };
    }

    if (reply.toUpperCase() === "HANDOFF_REQUIRED") {
      return { kind: "handoff", reason: "model_requested_handoff" };
    }

    return {
      kind: "reply",
      body: reply,
      model,
    };
  } catch (error) {
    chatLog("warn", "ai_reply_exception", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return { kind: "skip", reason: "ai_request_exception" };
  }
}
