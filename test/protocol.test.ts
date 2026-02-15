// ABOUTME: Tests for protocol translation between coven protobuf and openclaw messages.
// ABOUTME: Validates round-trip translation for all event types.

import { describe, it, expect } from "vitest";
import {
  covenSendMessageToInbound,
  openclawEventToMessageResponse,
  type OpenClawStreamEvent,
} from "../src/protocol.js";

describe("covenSendMessageToInbound", () => {
  it("translates a basic SendMessage to inbound format", () => {
    const msg = {
      request_id: "req-1",
      thread_id: "thread-abc",
      sender: "user@example.com",
      content: "Hello agent",
      attachments: [],
    };

    const result = covenSendMessageToInbound(msg, "default");

    expect(result.sessionKey).toBe("coven:default:thread-abc");
    expect(result.requestId).toBe("req-1");
    expect(result.sender).toBe("user@example.com");
    expect(result.content).toBe("Hello agent");
    expect(result.attachments).toEqual([]);
  });

  it("translates attachments", () => {
    const msg = {
      request_id: "req-2",
      thread_id: "thread-xyz",
      sender: "admin",
      content: "Check this file",
      attachments: [
        {
          filename: "test.png",
          mime_type: "image/png",
          data: Buffer.from("fake-image-data"),
        },
      ],
    };

    const result = covenSendMessageToInbound(msg, "default");

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].filename).toBe("test.png");
    expect(result.attachments[0].mimeType).toBe("image/png");
    expect(result.attachments[0].data).toBeInstanceOf(Buffer);
  });
});

describe("openclawEventToMessageResponse", () => {
  it("translates thinking event", () => {
    const event: OpenClawStreamEvent = { type: "thinking", content: "Let me think..." };
    const response = openclawEventToMessageResponse(event, "req-1");

    expect(response.request_id).toBe("req-1");
    expect(response.thinking).toBe("Let me think...");
  });

  it("translates text event", () => {
    const event: OpenClawStreamEvent = { type: "text", content: "Here is the answer." };
    const response = openclawEventToMessageResponse(event, "req-1");

    expect(response.request_id).toBe("req-1");
    expect(response.text).toBe("Here is the answer.");
  });

  it("translates done event", () => {
    const event: OpenClawStreamEvent = {
      type: "done",
      fullResponse: "Complete response here.",
    };
    const response = openclawEventToMessageResponse(event, "req-1");

    expect(response.request_id).toBe("req-1");
    expect(response.done).toEqual({ full_response: "Complete response here." });
  });

  it("translates error event", () => {
    const event: OpenClawStreamEvent = { type: "error", message: "Something broke" };
    const response = openclawEventToMessageResponse(event, "req-1");

    expect(response.request_id).toBe("req-1");
    expect(response.error).toBe("Something broke");
  });

  it("translates file event", () => {
    const event: OpenClawStreamEvent = {
      type: "file",
      filename: "output.txt",
      mimeType: "text/plain",
      data: Buffer.from("file contents"),
    };
    const response = openclawEventToMessageResponse(event, "req-1");

    expect(response.request_id).toBe("req-1");
    expect(response.file).toEqual({
      filename: "output.txt",
      mime_type: "text/plain",
      data: Buffer.from("file contents"),
    });
  });

  it("translates usage event", () => {
    const event: OpenClawStreamEvent = {
      type: "usage",
      inputTokens: 100,
      outputTokens: 50,
    };
    const response = openclawEventToMessageResponse(event, "req-1");

    expect(response.request_id).toBe("req-1");
    expect(response.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      thinking_tokens: 0,
    });
  });

  it("translates cancelled event", () => {
    const event: OpenClawStreamEvent = { type: "cancelled", reason: "user_requested" };
    const response = openclawEventToMessageResponse(event, "req-1");

    expect(response.request_id).toBe("req-1");
    expect(response.cancelled).toEqual({ reason: "user_requested" });
  });
});
