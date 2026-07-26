import { db } from "@/lib/db";

export type MatchedSupportPolicy = {
  id: string;
  title: string;
  category: string;
  keywords: string[];
  publicGuidance: string;
  internalNotes: string | null;
  autoResolveEnabled: boolean;
};

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function scorePolicy(policy: MatchedSupportPolicy, normalizedText: string) {
  if (!normalizedText) {
    return 0;
  }

  let score = 0;
  for (const keyword of policy.keywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (normalizedKeyword && normalizedText.includes(normalizedKeyword)) {
      score += 8;
    }
  }

  for (const token of normalizeText(`${policy.category} ${policy.title}`).split(" ")) {
    if (token.length >= 4 && normalizedText.includes(token)) {
      score += 2;
    }
  }

  return score;
}

export async function findRelevantSupportPolicies(input: {
  workspaceId: string;
  text: string;
  limit?: number;
}) {
  const limit = input.limit ?? 5;
  const policies: MatchedSupportPolicy[] = await db.supportPolicy.findMany({
    where: {
      workspaceId: input.workspaceId,
      isActive: true,
    },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    take: 50,
    select: {
      id: true,
      title: true,
      category: true,
      keywords: true,
      publicGuidance: true,
      internalNotes: true,
      autoResolveEnabled: true,
    },
  });

  const normalizedText = normalizeText(input.text);
  const scored = policies
    .map((policy) => ({ policy, score: scorePolicy(policy, normalizedText) }))
    .sort((left, right) => right.score - left.score);

  const matched = scored.filter((entry) => entry.score > 0).slice(0, limit).map((entry) => entry.policy);
  if (matched.length > 0) {
    return matched;
  }

  return policies.slice(0, Math.min(limit, 3));
}

export function formatPoliciesForPrompt(policies: MatchedSupportPolicy[]) {
  if (policies.length === 0) {
    return "No workspace support policies matched this conversation.";
  }

  return policies
    .map((policy, index) => {
      const lines = [
        `${index + 1}. ${policy.title}`,
        `Policy ID: ${policy.id}`,
        `Category: ${policy.category}`,
        `Customer guidance: ${policy.publicGuidance}`,
        policy.internalNotes ? `Internal handling notes: ${policy.internalNotes}` : null,
        `Auto-resolve allowed: ${policy.autoResolveEnabled ? "yes" : "no"}`,
      ].filter(Boolean);

      return lines.join("\n");
    })
    .join("\n\n");
}
