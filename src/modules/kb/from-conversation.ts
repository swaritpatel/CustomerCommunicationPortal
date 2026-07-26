import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { chatLog } from "@/modules/chat/log";
import { toWorkspaceSlug } from "@/modules/workspaces/slug";

type ConversationMessage = {
  senderType: "VISITOR" | "AGENT" | "SYSTEM";
  body: string;
  senderUser?: { fullName: string } | null;
  createdAt: Date;
};

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stripTags(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeRichText(html: string) {
  const cleaned = html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\s(href|src)="javascript:[^"]*"/gi, "");

  const allowed = new Set(["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "h2", "h3"]);

  return cleaned.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (match, tagName: string) => {
    const tag = tagName.toLowerCase();
    if (!allowed.has(tag)) {
      return "";
    }
    return match.startsWith("</") ? `</${tag}>` : `<${tag}>`;
  });
}

function speakerLabel(message: ConversationMessage) {
  if (message.senderType === "VISITOR") {
    return "Customer";
  }
  if (message.senderType === "SYSTEM") {
    return "System";
  }
  return message.senderUser?.fullName?.trim() || "Agent";
}

function buildTranscript(messages: ConversationMessage[]) {
  return messages
    .map((message) => `${speakerLabel(message)}: ${cleanText(message.body).slice(0, 1200)}`)
    .join("\n");
}

async function generateUniqueSlug(input: { workspaceId: string; title: string }) {
  const base = toWorkspaceSlug(input.title) || `article-${crypto.randomUUID().slice(0, 8)}`;

  for (let index = 0; index < 12; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    const existing = await db.knowledgeBaseArticle.findUnique({
      where: { workspaceId_slug: { workspaceId: input.workspaceId, slug: candidate } },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

function fallbackArticle(input: {
  subject: string;
  customerName?: string | null;
  messages: ConversationMessage[];
}) {
  const latestCustomerMessage = [...input.messages].reverse().find((message) => message.senderType === "VISITOR");
  const request = cleanText(latestCustomerMessage?.body || input.subject);
  const title = input.subject.toLowerCase().startsWith("how to")
    ? input.subject
    : `Handling ${input.subject}`;
  const excerpt = `Support guidance for customer requests about ${input.subject}.`;

  return {
    title: cleanText(title).slice(0, 90),
    excerpt: excerpt.slice(0, 180),
    contentHtml: [
      `<h2>Customer issue</h2>`,
      `<p>${escapeHtml(request || `The customer needs help with ${input.subject}.`)}</p>`,
      `<h2>Recommended response</h2>`,
      `<p>Thank the customer for contacting support, confirm that the request has been received, and explain the next step clearly.</p>`,
      `<h2>Agent checklist</h2>`,
      `<ul>`,
      `<li>Review the customer account and order details before promising a resolution.</li>`,
      `<li>Share expected timelines from the active support policy.</li>`,
      `<li>Keep the conversation open if the policy timeline has already passed.</li>`,
      `</ul>`,
    ].join(""),
  };
}

function parseAiArticle(content: string) {
  const trimmed = content.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(trimmed) as {
    title?: string;
    excerpt?: string;
    contentHtml?: string;
  };

  if (!parsed.title || !parsed.contentHtml) {
    return null;
  }

  return {
    title: cleanText(parsed.title).slice(0, 90),
    excerpt: cleanText(parsed.excerpt || stripTags(parsed.contentHtml)).slice(0, 180),
    contentHtml: sanitizeRichText(parsed.contentHtml),
  };
}

async function generateArticle(input: {
  workspaceName: string;
  subject: string;
  customerName?: string | null;
  messages: ConversationMessage[];
}) {
  const fallback = fallbackArticle(input);

  if (!serverEnv.AI_API_KEY) {
    return fallback;
  }

  const model = serverEnv.AI_MODEL || "gpt-4o-mini";
  const baseUrl = (serverEnv.AI_BASE_URL || "https://api.openai.com").replace(/\/$/, "");

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
        max_tokens: Math.min(serverEnv.AI_MAX_TOKENS ?? 720, 900),
        messages: [
          {
            role: "system",
            content:
              "Create concise customer-support knowledge base articles from resolved or recurring issues. Prefer the final successful human resolution when available. Do not include customer personal data. Do not invent policies, refunds, dates, amounts, or guarantees. Return only valid JSON.",
          },
          {
            role: "user",
            content: [
              `Workspace: ${input.workspaceName}`,
              `Conversation subject: ${input.subject}`,
              `Customer: ${input.customerName || "Unknown"}`,
              "",
              "Conversation transcript:",
              buildTranscript(input.messages.slice(-30)) || "(No messages)",
              "",
              "Create a reusable article for agents and self-service customers.",
              "Return JSON with exactly:",
              "{",
              '  "title": "short article title, not copied from subject unless natural",',
              '  "excerpt": "one sentence summary",',
              '  "contentHtml": "<h2>Overview</h2><p>...</p><h2>What to tell the customer</h2><p>...</p><h2>Agent checklist</h2><ul><li>...</li></ul>"',
              "}",
            ].join("\n"),
          },
        ],
      }),
    });

    if (!response.ok) {
      chatLog("warn", "kb_from_conversation_ai_status", { status: response.status });
      return fallback;
    }

    const payload = await response.json().catch(() => null);
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return fallback;
    }

    return parseAiArticle(content) ?? fallback;
  } catch (error) {
    chatLog("warn", "kb_from_conversation_ai_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return fallback;
  }
}

export async function createKnowledgeArticleFromConversation(input: {
  workspaceId: string;
  conversationId: string;
  authorUserId?: string | null;
  status?: "DRAFT" | "PUBLISHED";
}) {
  const conversation = await db.conversation.findUnique({
    where: { id: input.conversationId },
    select: {
      id: true,
      workspaceId: true,
      subject: true,
      customerName: true,
      workspace: {
        select: {
          name: true,
          slug: true,
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        take: 40,
        select: {
          senderType: true,
          body: true,
          createdAt: true,
          senderUser: {
            select: { fullName: true },
          },
        },
      },
    },
  });

  if (!conversation || conversation.workspaceId !== input.workspaceId) {
    return { ok: false as const, error: "Conversation not found", status: 404 };
  }

  if (conversation.messages.length === 0) {
    return { ok: false as const, error: "Conversation has no messages to learn from", status: 400 };
  }

  const category = await db.knowledgeBaseCategory.upsert({
    where: {
      workspaceId_slug: {
        workspaceId: conversation.workspaceId,
        slug: "support-issues",
      },
    },
    create: {
      workspaceId: conversation.workspaceId,
      title: "Support Issues",
      slug: "support-issues",
      description: "Agent-created articles from recurring customer conversations.",
    },
    update: {},
    select: { id: true },
  });

  const generated = await generateArticle({
    workspaceName: conversation.workspace.name,
    subject: conversation.subject,
    customerName: conversation.customerName,
    messages: conversation.messages,
  });
  const slug = await generateUniqueSlug({
    workspaceId: conversation.workspaceId,
    title: generated.title,
  });

  const status = input.status ?? "PUBLISHED";
  const article = await db.knowledgeBaseArticle.create({
    data: {
      workspaceId: conversation.workspaceId,
      categoryId: category.id,
      authorUserId: input.authorUserId,
      title: generated.title,
      slug,
      excerpt: generated.excerpt,
      contentHtml: generated.contentHtml,
      status,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
    },
    select: {
      id: true,
      title: true,
      slug: true,
      excerpt: true,
    },
  });

  chatLog("info", "kb_article_created_from_conversation", {
    workspaceId: conversation.workspaceId,
    conversationId: conversation.id,
    articleId: article.id,
    slug: article.slug,
    status,
  });

  return {
    ok: true as const,
    article: {
      ...article,
      href: `/help/${conversation.workspace.slug}?article=${article.slug}`,
    },
  };
}
