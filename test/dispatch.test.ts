// ABOUTME: Tests for coven inbound message dispatch to openclaw auto-reply system.
// ABOUTME: Verifies MsgContext construction and runtime dispatch wiring.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildCovenMsgContext } from "../src/dispatch.js";
import type { InboundMessage } from "../src/protocol.js";

describe("buildCovenMsgContext", () => {
  const inbound: InboundMessage = {
    sessionKey: "coven:default:thread-123",
    requestId: "req-abc",
    sender: "alice",
    content: "Hello from coven",
    attachments: [],
  };

  it("sets Body and BodyForAgent from inbound content", () => {
    const ctx = buildCovenMsgContext(inbound, "default");
    expect(ctx.Body).toBe("Hello from coven");
    expect(ctx.BodyForAgent).toBe("Hello from coven");
  });

  it("sets From with coven prefix, account, and sender", () => {
    const ctx = buildCovenMsgContext(inbound, "default");
    expect(ctx.From).toBe("coven:default:alice");
  });

  it("sets To as the session key", () => {
    const ctx = buildCovenMsgContext(inbound, "default");
    expect(ctx.To).toBe("coven:default:thread-123");
  });

  it("sets SessionKey from inbound", () => {
    const ctx = buildCovenMsgContext(inbound, "default");
    expect(ctx.SessionKey).toBe("coven:default:thread-123");
  });

  it("sets AccountId from parameter", () => {
    const ctx = buildCovenMsgContext(inbound, "staging");
    expect(ctx.AccountId).toBe("staging");
  });

  it("sets Surface to coven", () => {
    const ctx = buildCovenMsgContext(inbound, "default");
    expect(ctx.Surface).toBe("coven");
  });

  it("sets ChatType to direct", () => {
    const ctx = buildCovenMsgContext(inbound, "default");
    expect(ctx.ChatType).toBe("direct");
  });

  it("sets SenderName and SenderId from sender", () => {
    const ctx = buildCovenMsgContext(inbound, "default");
    expect(ctx.SenderName).toBe("alice");
    expect(ctx.SenderId).toBe("alice");
  });

  it("sets MessageSid from requestId", () => {
    const ctx = buildCovenMsgContext(inbound, "default");
    expect(ctx.MessageSid).toBe("req-abc");
  });

  it("sets Timestamp to a recent value", () => {
    const before = Date.now();
    const ctx = buildCovenMsgContext(inbound, "default");
    const after = Date.now();
    expect(ctx.Timestamp).toBeGreaterThanOrEqual(before);
    expect(ctx.Timestamp).toBeLessThanOrEqual(after);
  });

  it("sets CommandAuthorized to false", () => {
    const ctx = buildCovenMsgContext(inbound, "default");
    expect(ctx.CommandAuthorized).toBe(false);
  });
});
