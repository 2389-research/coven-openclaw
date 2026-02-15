// ABOUTME: Session key normalization for coven channel targets.
// ABOUTME: Handles "coven:{accountId}:{threadId}" format parsing and formatting.

const COVEN_PREFIX = "coven:";

export type ParsedSessionKey = {
  accountId: string;
  threadId: string;
};

export function formatSessionKey(
  accountId: string,
  threadId: string
): string {
  return `${COVEN_PREFIX}${accountId}:${threadId}`;
}

export function parseSessionKey(raw: string): ParsedSessionKey | null {
  if (!raw.startsWith(COVEN_PREFIX)) {
    return null;
  }

  const rest = raw.slice(COVEN_PREFIX.length);
  const colonIndex = rest.indexOf(":");
  if (colonIndex < 0) {
    return null;
  }

  const accountId = rest.slice(0, colonIndex);
  const threadId = rest.slice(colonIndex + 1);

  if (!accountId || !threadId) {
    return null;
  }

  return { accountId, threadId };
}

export function normalizeCovenTarget(raw: string): string | undefined {
  const parsed = parseSessionKey(raw);
  if (!parsed) {
    return undefined;
  }
  return raw;
}
