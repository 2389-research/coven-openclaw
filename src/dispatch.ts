// ABOUTME: Bridges coven inbound messages into openclaw's auto-reply dispatch system.
// ABOUTME: Builds MsgContext and wires reply delivery back through the gRPC stream.

import type { PluginRuntime, ReplyPayload } from "openclaw/plugin-sdk";
import type { InboundMessage } from "./protocol.js";
import type { CovenGrpcClient } from "./grpc-client.js";
import type { ResolvedCovenAccount } from "./config.js";

type MsgContext = Record<string, unknown>;
type OpenClawConfig = Record<string, unknown>;
type ChannelLogSink = {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

export function buildCovenMsgContext(
  inbound: InboundMessage,
  accountId: string
): MsgContext {
  return {
    Body: inbound.content,
    BodyForAgent: inbound.content,
    From: `coven:${accountId}:${inbound.sender}`,
    To: inbound.sessionKey,
    SessionKey: inbound.sessionKey,
    AccountId: accountId,
    Surface: "coven",
    ChatType: "direct",
    SenderName: inbound.sender,
    SenderId: inbound.sender,
    MessageSid: inbound.requestId,
    Timestamp: Date.now(),
    CommandAuthorized: false,
  };
}

export async function dispatchCovenInbound(params: {
  inbound: InboundMessage;
  account: ResolvedCovenAccount;
  client: CovenGrpcClient;
  cfg: OpenClawConfig;
  runtime: PluginRuntime;
  log?: ChannelLogSink;
}): Promise<void> {
  const { inbound, account, client, cfg, runtime, log } = params;

  const msgCtx = buildCovenMsgContext(inbound, account.accountId);

  try {
    await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: msgCtx as any,
      cfg: cfg as any,
      dispatcherOptions: {
        deliver: async (payload: ReplyPayload, info: { kind: string }) => {
          if (!client.connected) return;

          if (payload.text) {
            if (info.kind === "final") {
              client.send({
                response: {
                  request_id: inbound.requestId,
                  done: { full_response: payload.text },
                },
              });
            } else {
              client.send({
                response: {
                  request_id: inbound.requestId,
                  text: payload.text,
                },
              });
            }
          }
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.error?.(`[${account.accountId}] dispatch error: ${message}`);

    if (client.connected) {
      client.send({
        response: {
          request_id: inbound.requestId,
          error: message,
        },
      });
    }
  }
}
