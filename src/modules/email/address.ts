import type { ParsedMailbox } from "@/modules/email/types";

const emailPattern = /<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/;

export function parseMailbox(value: string | null | undefined): ParsedMailbox | null {
  const source = value?.trim();
  if (!source) {
    return null;
  }

  const match = source.match(emailPattern);
  if (!match) {
    return null;
  }

  const email = match[1].toLowerCase();
  const displayName = source.replace(match[0], "").replace(/[\"<>]/g, "").trim();

  return {
    email,
    name: displayName.length > 0 ? displayName : null,
  };
}

export function normalizeMessageId(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  const unwrapped = candidate.replace(/^<|>$/g, "").trim();
  return unwrapped.length > 0 ? unwrapped : null;
}

export function splitReferenceHeader(value: string | null | undefined) {
  const source = value?.trim();
  if (!source) {
    return [];
  }

  return source
    .split(/\s+/)
    .map((entry) => normalizeMessageId(entry))
    .filter((entry): entry is string => Boolean(entry));
}
