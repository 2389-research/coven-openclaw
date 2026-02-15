// ABOUTME: Pure translation functions between coven protobuf messages and openclaw format.
// ABOUTME: No side effects — converts inbound SendMessage and outbound stream events.

import { formatSessionKey } from "./normalize.js";

// --- Inbound types (coven -> openclaw) ---

export type CovenSendMessage = {
  request_id: string;
  thread_id: string;
  sender: string;
  content: string;
  attachments: CovenFileAttachment[];
};

export type CovenFileAttachment = {
  filename: string;
  mime_type: string;
  data: Buffer | Uint8Array;
};

export type InboundMessage = {
  sessionKey: string;
  requestId: string;
  sender: string;
  content: string;
  attachments: InboundAttachment[];
};

export type InboundAttachment = {
  filename: string;
  mimeType: string;
  data: Buffer;
};

export function covenSendMessageToInbound(
  msg: CovenSendMessage,
  accountId: string
): InboundMessage {
  return {
    sessionKey: formatSessionKey(accountId, msg.thread_id),
    requestId: msg.request_id,
    sender: msg.sender,
    content: msg.content,
    attachments: (msg.attachments ?? []).map((att) => ({
      filename: att.filename,
      mimeType: att.mime_type,
      data: Buffer.isBuffer(att.data) ? att.data : Buffer.from(att.data),
    })),
  };
}

// --- Outbound types (openclaw -> coven) ---

export type OpenClawStreamEvent =
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  | { type: "done"; fullResponse: string }
  | { type: "error"; message: string }
  | { type: "file"; filename: string; mimeType: string; data: Buffer }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      thinkingTokens?: number;
    }
  | { type: "cancelled"; reason: string };

export type MessageResponsePayload = Record<string, any> & {
  request_id: string;
};

export function openclawEventToMessageResponse(
  event: OpenClawStreamEvent,
  requestId: string
): MessageResponsePayload {
  const base = { request_id: requestId };

  switch (event.type) {
    case "thinking":
      return { ...base, thinking: event.content };
    case "text":
      return { ...base, text: event.content };
    case "done":
      return { ...base, done: { full_response: event.fullResponse } };
    case "error":
      return { ...base, error: event.message };
    case "file":
      return {
        ...base,
        file: {
          filename: event.filename,
          mime_type: event.mimeType,
          data: event.data,
        },
      };
    case "usage":
      return {
        ...base,
        usage: {
          input_tokens: event.inputTokens,
          output_tokens: event.outputTokens,
          cache_read_tokens: event.cacheReadTokens ?? 0,
          cache_write_tokens: event.cacheWriteTokens ?? 0,
          thinking_tokens: event.thinkingTokens ?? 0,
        },
      };
    case "cancelled":
      return { ...base, cancelled: { reason: event.reason } };
  }
}
