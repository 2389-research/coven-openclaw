// ABOUTME: Tests for coven session key normalization.
// ABOUTME: Validates parsing and formatting of "coven:{accountId}:{threadId}" keys.

import { describe, it, expect } from "vitest";
import {
  formatSessionKey,
  parseSessionKey,
  normalizeCovenTarget,
} from "../src/normalize.js";

describe("formatSessionKey", () => {
  it("formats a session key from accountId and threadId", () => {
    expect(formatSessionKey("default", "thread-123")).toBe(
      "coven:default:thread-123"
    );
  });

  it("handles multi-segment thread IDs", () => {
    expect(formatSessionKey("prod", "room:abc:456")).toBe(
      "coven:prod:room:abc:456"
    );
  });
});

describe("parseSessionKey", () => {
  it("parses a valid session key", () => {
    const result = parseSessionKey("coven:default:thread-123");
    expect(result).toEqual({ accountId: "default", threadId: "thread-123" });
  });

  it("parses session key with multi-segment threadId", () => {
    const result = parseSessionKey("coven:prod:room:abc:456");
    expect(result).toEqual({ accountId: "prod", threadId: "room:abc:456" });
  });

  it("returns null for non-coven keys", () => {
    expect(parseSessionKey("discord:default:123")).toBeNull();
  });

  it("returns null for malformed keys (missing threadId)", () => {
    expect(parseSessionKey("coven:default")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSessionKey("")).toBeNull();
  });
});

describe("normalizeCovenTarget", () => {
  it("passes through valid coven session keys", () => {
    expect(normalizeCovenTarget("coven:default:thread-123")).toBe(
      "coven:default:thread-123"
    );
  });

  it("returns undefined for non-coven targets", () => {
    expect(normalizeCovenTarget("discord:foo:bar")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(normalizeCovenTarget("")).toBeUndefined();
  });
});
