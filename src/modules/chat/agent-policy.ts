export type AgentPolicy = {
  name: string;
  tone: string[];
  mandatory: string[];
  disallowed: string[];
  escalationTriggers: RegExp[];
};

const DEFAULT_POLICY: AgentPolicy = {
  name: "default-support",
  tone: [
    "Be human, warm, and concise.",
    "Use short paragraphs and avoid robotic wording.",
    "Mirror the customer's language level and pace.",
  ],
  mandatory: [
    "Acknowledge the user's latest concern before proposing steps.",
    "If information is missing, ask exactly one clear follow-up question.",
    "Never fabricate account, billing, legal, or technical facts.",
  ],
  disallowed: [
    "Do not promise refunds, credits, legal outcomes, or security guarantees.",
    "Do not ask for passwords, one-time codes, or secret tokens.",
    "Do not claim an action was completed unless explicitly confirmed by system data.",
  ],
  escalationTriggers: [
    /refund|chargeback|cancel and refund|money back/i,
    /legal|lawyer|attorney|court|sue/i,
    /security breach|hacked|data leak|breach/i,
    /angry|furious|unacceptable|terrible service/i,
  ],
};

export function getAgentPolicy(name?: string): AgentPolicy {
  if (!name || name === DEFAULT_POLICY.name) {
    return DEFAULT_POLICY;
  }

  return {
    ...DEFAULT_POLICY,
    name,
  };
}

export function shouldEscalateByPolicy(policy: AgentPolicy, message: string) {
  const trimmed = message.trim();
  if (!trimmed) {
    return { shouldEscalate: false, reason: null as string | null };
  }

  const trigger = policy.escalationTriggers.find((pattern) => pattern.test(trimmed));
  if (!trigger) {
    return { shouldEscalate: false, reason: null as string | null };
  }

  return {
    shouldEscalate: true,
    reason: `Matched escalation trigger: ${trigger.source}`,
  };
}

export function buildPolicySystemPrompt(policy: AgentPolicy) {
  return [
    "You are a customer support chat agent for CCP (Customer Communication Platform).",
    "Follow the policy strictly while sounding natural and helpful.",
    "",
    `Policy: ${policy.name}`,
    "Tone:",
    ...policy.tone.map((line) => `- ${line}`),
    "Mandatory:",
    ...policy.mandatory.map((line) => `- ${line}`),
    "Disallowed:",
    ...policy.disallowed.map((line) => `- ${line}`),
    "",
    "Output requirements:",
    "- Keep the response to at most 120 words.",
    "- If the request needs escalation, use exactly: HANDOFF_REQUIRED as the reply value.",
  ].join("\n");
}
