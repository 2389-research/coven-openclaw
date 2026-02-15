// ABOUTME: ChannelPlugin definition wiring all coven adapters together.
// ABOUTME: Follows the same pattern as openclaw's Discord channel plugin.

import type { ChannelPlugin } from "openclaw/plugin-sdk";
import {
  listCovenAccountIds,
  resolveCovenAccount,
  type ResolvedCovenAccount,
} from "./config.js";
import { normalizeCovenTarget } from "./normalize.js";
import { CovenGrpcClient, type CovenWelcome } from "./grpc-client.js";
import { covenSendMessageToInbound } from "./protocol.js";
import { probeCoven, type CovenProbeResult } from "./status.js";
import { registerCovenMcp, unregisterCovenMcp } from "./mcp-bridge.js";
import { dispatchCovenInbound } from "./dispatch.js";
import { getCovenRuntime } from "./runtime.js";

// Track active gRPC clients per account
const activeClients = new Map<string, CovenGrpcClient>();

export const covenPlugin: ChannelPlugin<ResolvedCovenAccount, CovenProbeResult> = {
  id: "coven" as any,

  meta: {
    id: "coven" as any,
    label: "Coven Gateway",
    selectionLabel: "Coven Gateway (gRPC)",
    docsPath: "/channels/coven",
    blurb: "Connect openclaw agents to coven-gateway via gRPC AgentStream.",
    order: 90,
  },

  capabilities: {
    chatTypes: ["direct", "thread"],
    media: true,
  },

  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 1500, idleMs: 1000 },
  },

  reload: { configPrefixes: ["channels.coven"] },

  config: {
    listAccountIds: (cfg) => listCovenAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveCovenAccount(cfg, accountId),
    defaultAccountId: () => "default",
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const next = structuredClone(cfg);
      if (!next.channels) next.channels = {};
      if (!next.channels.coven) next.channels.coven = {};
      if (!next.channels.coven.accounts) next.channels.coven.accounts = {};
      if (!next.channels.coven.accounts[accountId]) {
        next.channels.coven.accounts[accountId] = {};
      }
      next.channels.coven.accounts[accountId].enabled = enabled;
      return next;
    },
    isConfigured: (account) => Boolean(account.endpoint?.trim()),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: `coven-${account.accountId}`,
      enabled: account.enabled,
      configured: Boolean(account.endpoint?.trim()),
    }),
  },

  messaging: {
    normalizeTarget: normalizeCovenTarget,
    targetResolver: {
      looksLikeId: (raw) => raw.startsWith("coven:"),
      hint: "coven:<accountId>:<threadId>",
    },
  },

  heartbeat: {
    checkReady: async ({ cfg, accountId }) => {
      const account = resolveCovenAccount(cfg, accountId);
      const client = activeClients.get(account.accountId);
      if (!client || !client.connected) {
        return { ok: false, reason: "coven-not-connected" };
      }
      return { ok: true, reason: "ok" };
    },
  },

  status: {
    defaultRuntime: {
      accountId: "default",
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    probeAccount: async ({ account, timeoutMs }) =>
      probeCoven(account, timeoutMs),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: `coven-${account.accountId}`,
      enabled: account.enabled,
      configured: Boolean(account.endpoint?.trim()),
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      probe,
    }),
  },

  outbound: {
    deliveryMode: "direct",
    chunker: null,
    textChunkLimit: 4000,
    sendText: async ({ to, text }) => {
      const parts = to.split(":");
      if (parts.length < 3 || parts[0] !== "coven") {
        throw new Error(`Invalid coven target: ${to}`);
      }
      const accountId = parts[1];
      const client = activeClients.get(accountId);
      if (!client || !client.connected) {
        throw new Error(`No active coven connection for account: ${accountId}`);
      }

      client.send({
        response: {
          request_id: "",
          text,
        },
      });

      return {
        channel: "coven" as any,
        messageId: `coven-${Date.now()}`,
      };
    },
    sendMedia: async ({ to }) => {
      const parts = to.split(":");
      const accountId = parts[1] ?? "default";
      const client = activeClients.get(accountId);
      if (!client || !client.connected) {
        throw new Error(`No active coven connection for account: ${accountId}`);
      }

      return {
        channel: "coven" as any,
        messageId: `coven-${Date.now()}`,
      };
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const agentName = account.mode === "single" ? "openclaw" : "default";

      ctx.log?.info?.(
        `[${account.accountId}] connecting to coven-gateway at ${account.endpoint}`
      );

      const client = new CovenGrpcClient(account);
      activeClients.set(account.accountId, client);

      try {
        const welcome = await client.connect(agentName);
        ctx.log?.info?.(
          `[${account.accountId}] registered as ${welcome.agent_id} (instance: ${welcome.instance_id})`
        );

        if (welcome.mcp_endpoint && welcome.mcp_token) {
          registerCovenMcp(welcome);
          ctx.log?.info?.(
            `[${account.accountId}] MCP bridge registered at ${welcome.mcp_endpoint}`
          );
        }

        client.on("send_message", (msg: any) => {
          const inbound = covenSendMessageToInbound(msg, account.accountId);
          ctx.log?.info?.(
            `[${account.accountId}] inbound message: ${inbound.requestId} from ${inbound.sender}`
          );

          dispatchCovenInbound({
            inbound,
            account,
            client,
            cfg: ctx.cfg,
            runtime: getCovenRuntime(),
            log: ctx.log,
          }).catch((err) => {
            ctx.log?.error?.(
              `[${account.accountId}] unhandled dispatch error: ${err}`
            );
          });
        });

        client.on("inject_context", (msg: any) => {
          ctx.log?.info?.(
            `[${account.accountId}] context injection: ${msg.injection_id}`
          );
          client.send({
            injection_ack: {
              injection_id: msg.injection_id,
              accepted: true,
            },
          });
        });

        client.on("cancel_request", (msg: any) => {
          ctx.log?.info?.(
            `[${account.accountId}] cancel request: ${msg.request_id}`
          );
          client.send({
            response: {
              request_id: msg.request_id,
              cancelled: { reason: msg.reason ?? "server_requested" },
            },
          });
        });

        client.on("shutdown", (msg: any) => {
          ctx.log?.warn?.(
            `[${account.accountId}] server shutdown: ${msg.reason}`
          );
          client.disconnect();
        });

        client.on("disconnected", async () => {
          ctx.log?.warn?.(
            `[${account.accountId}] disconnected, attempting reconnect...`
          );
          unregisterCovenMcp();
          const newWelcome = await client.reconnect();
          if (newWelcome) {
            ctx.log?.info?.(
              `[${account.accountId}] reconnected as ${newWelcome.agent_id}`
            );
            if (newWelcome.mcp_endpoint && newWelcome.mcp_token) {
              registerCovenMcp(newWelcome);
            }
          } else {
            ctx.log?.error?.(
              `[${account.accountId}] reconnection failed after max attempts`
            );
          }
        });

        client.on("error", (err: Error) => {
          ctx.log?.error?.(
            `[${account.accountId}] gRPC error: ${err.message}`
          );
        });
      } catch (err) {
        activeClients.delete(account.accountId);
        throw err;
      }

      return () => {
        const c = activeClients.get(account.accountId);
        if (c) {
          c.disconnect();
          activeClients.delete(account.accountId);
          unregisterCovenMcp();
        }
      };
    },
  },
};
