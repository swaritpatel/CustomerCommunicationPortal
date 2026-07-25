import { serverEnv } from "@/lib/env";
import { chatLog } from "@/modules/chat/log";

type SummaryMessage = {
  senderType: "VISITOR" | "AGENT" | "SYSTEM";
  body: string;
  senderName?: string | null;
  createdAt?: Date | string;
};

export type ConversationSummary = {
  summary: string;
  userWants: string[];
  tried: string[];
  currentStatus: string;
  keyDetails: string[];
  generatedAt: string;
  source: "llm" | "fallback";
  model?: string;
};

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function messageSpeaker(message: SummaryMessage) {
  if (message.senderType === "VISITOR") {
    return "Customer";
  }
  if (message.senderType === "SYSTEM") {
    return "System";
  }
  return message.senderName?.trim() || "Agent";
}

function asTranscript(messages: SummaryMessage[]) {
  return messages
    .map((message) => {
      const timestamp = message.createdAt ? new Date(message.createdAt).toISOString() : "";
      const body = cleanText(message.body).slice(0, 1200);
      return `${timestamp ? `[${timestamp}] ` : ""}${messageSpeaker(message)}: ${body}`;
    })
    .join("\n");
}

function latestVisitorMessage(messages: SummaryMessage[]) {
  return [...messages].reverse().find((message) => message.senderType === "VISITOR");
}

function latestAgentMessage(messages: SummaryMessage[]) {
  return [...messages].reverse().find((message) => message.senderType === "AGENT");
}

function uniqueLines(lines: string[]) {
  const seen = new Set<string>();
  return lines
    .map((line) => cleanText(line))
    .filter((line) => {
      if (!line || seen.has(line.toLowerCase())) {
        return false;
      }
      seen.add(line.toLowerCase());
      return true;
    })
    .slice(0, 4);
}

function fallbackSummary(input: {
  subject: string;
  customerName?: string | null;
  messages: SummaryMessage[];
}): ConversationSummary {
  const latestCustomer = latestVisitorMessage(input.messages);
  const latestAgent = latestAgentMessage(input.messages);
  const customerExcerpt = cleanText(latestCustomer?.body || "").slice(0, 220);
  const agentExcerpt = cleanText(latestAgent?.body || "").slice(0, 220);

  return {
    summary: customerExcerpt
      ? `${input.customerName?.trim() || "The customer"} is asking about ${input.subject}. Latest customer note: ${customerExcerpt}`
      : `Conversation about ${input.subject}. No customer request has been captured yet.`,
    userWants: uniqueLines([
      customerExcerpt || `Help with ${input.subject}`,
      input.subject,
    ]),
    tried: uniqueLines([
      agentExcerpt ? `Agent replied: ${agentExcerpt}` : "",
      input.messages.some((message) => message.senderType === "AGENT") ? "A support reply has been sent." : "",
    ]),
    currentStatus: latestAgent
      ? "Agent has responded; waiting for the next customer signal or final resolution."
      : "Customer is waiting for the first agent response.",
    keyDetails: uniqueLines([
      `Messages in thread: ${input.messages.length}`,
      `Latest speaker: ${input.messages.length > 0 ? messageSpeaker(input.messages[input.messages.length - 1]) : "None"}`,
      input.customerName ? `Customer: ${input.customerName}` : "",
    ]),
    generatedAt: new Date().toISOString(),
    source: "fallback",
  };
}

function extractText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const first = choices[0] as { message?: { content?: unknown } };
  return typeof first.message?.content === "string" ? first.message.content.trim() : null;
}

function parseSummary(content: string, model: string): ConversationSummary | null {
  const trimmed = content.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

  try {
    const parsed = JSON.parse(trimmed) as Partial<ConversationSummary>;
    if (!parsed.summary || !parsed.currentStatus) {
      return null;
    }

    return {
      summary: cleanText(parsed.summary).slice(0, 420),
      userWants: Array.isArray(parsed.userWants) ? parsed.userWants.map(cleanText).filter(Boolean).slice(0, 5) : [],
      tried: Array.isArray(parsed.tried) ? parsed.tried.map(cleanText).filter(Boolean).slice(0, 5) : [],
      currentStatus: cleanText(parsed.currentStatus).slice(0, 260),
      keyDetails: Array.isArray(parsed.keyDetails) ? parsed.keyDetails.map(cleanText).filter(Boolean).slice(0, 6) : [],
      generatedAt: new Date().toISOString(),
      source: "llm",
      model,
    };
  } catch {
    return null;
  }
}

export async function summarizeConversation(input: {
  workspaceName?: string | null;
  subject: string;
  customerName?: string | null;
  customerEmail?: string | null;
  messages: SummaryMessage[];
}): Promise<ConversationSummary> {
  const fallback = fallbackSummary(input);

  if (!serverEnv.AI_API_KEY) {
    return fallback;
  }

  const model = serverEnv.AI_MODEL || "gpt-4o-mini";
  const baseUrl = (serverEnv.AI_BASE_URL || "https://api.openai.com").replace(/\/$/, "");
  const transcript = asTranscript(input.messages.slice(-60));

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${serverEnv.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: Math.min(serverEnv.AI_MAX_TOKENS ?? 520, 700),
        messages: [
          {
            role: "system",
            content:
              "You summarize customer support conversations for agents. Be concise, factual, and avoid inventing details. Return only valid JSON.",
          },
          {
            role: "user",
            content: [
              `Workspace: ${input.workspaceName || "CCP Workspace"}`,
              `Subject: ${input.subject}`,
              `Customer: ${input.customerName || input.customerEmail || "Unknown"}`,
              "",
              "Transcript:",
              transcript || "(No messages)",
              "",
              "Return JSON with exactly these fields:",
              "{",
              '  "summary": "2 sentence concise overview",',
              '  "userWants": ["what the user wants"],',
              '  "tried": ["what has been tried or sent so far"],',
              '  "currentStatus": "current status and next likely step",',
              '  "keyDetails": ["specific IDs, dates, constraints, links, blockers"]',
              "}",
            ].join("\n"),
          },
        ],
      }),
    });

    if (!response.ok) {
      chatLog("warn", "inbox_summary_ai_status", { status: response.status });
      return fallback;
    }

    const content = extractText(await response.json().catch(() => null));
    const parsed = content ? parseSummary(content, model) : null;
    return parsed ?? fallback;
  } catch (error) {
    chatLog("warn", "inbox_summary_ai_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return fallback;
  }
}
