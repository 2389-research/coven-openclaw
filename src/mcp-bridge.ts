// ABOUTME: Manages dynamic MCP server registration from coven-gateway Welcome messages.
// ABOUTME: Registers coven's MCP endpoint on connect, unregisters on disconnect.

import type { CovenWelcome } from "./grpc-client.js";

export type McpBridgeState = {
  registered: boolean;
  endpoint: string | null;
};

let bridgeState: McpBridgeState = {
  registered: false,
  endpoint: null,
};

export function getMcpBridgeState(): McpBridgeState {
  return { ...bridgeState };
}

export function registerCovenMcp(welcome: CovenWelcome): void {
  if (!welcome.mcp_endpoint || !welcome.mcp_token) {
    return;
  }

  bridgeState = {
    registered: true,
    endpoint: welcome.mcp_endpoint,
  };

  // Registration with the actual openclaw MCP infrastructure happens
  // through the PluginRuntime — wired in channel.ts when runtime is available.
}

export function unregisterCovenMcp(): void {
  bridgeState = {
    registered: false,
    endpoint: null,
  };
}
