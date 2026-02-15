// ABOUTME: CLI onboarding wizard for setting up coven-gateway connections.
// ABOUTME: Walks through endpoint, auth method, agent mode, and connection testing.

import type { ResolvedCovenAccount } from "./config.js";
import { probeCoven } from "./status.js";
import {
  DEFAULT_ENDPOINT,
  DEFAULT_MODE,
  DEFAULT_AUTH_METHOD,
} from "./config-schema.js";

export type OnboardingResult = {
  endpoint: string;
  authMethod: string;
  sshKeyPath?: string;
  jwtSecret?: string;
  mode: string;
  tls: boolean;
  connectionTestPassed: boolean;
};

export type OnboardingContext = {
  prompt: (message: string, defaultValue?: string) => Promise<string>;
  select: (
    message: string,
    choices: { label: string; value: string }[]
  ) => Promise<string>;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    success: (msg: string) => void;
  };
};

export async function runOnboarding(
  ctx: OnboardingContext
): Promise<OnboardingResult> {
  ctx.log.info("Setting up Coven Gateway connection...\n");

  // 1. Endpoint
  const endpoint = await ctx.prompt(
    "gRPC endpoint",
    DEFAULT_ENDPOINT
  );

  // 2. TLS
  const tlsChoice = await ctx.select("Use TLS?", [
    { label: "No (local/dev)", value: "false" },
    { label: "Yes (production/tailscale)", value: "true" },
  ]);
  const tls = tlsChoice === "true";

  // 3. Auth method
  const authMethod = await ctx.select("Authentication method", [
    { label: "SSH key", value: "ssh" },
    { label: "JWT token", value: "jwt" },
    { label: "None (dev mode)", value: "none" },
  ]);

  let sshKeyPath: string | undefined;
  let jwtSecret: string | undefined;

  if (authMethod === "ssh") {
    sshKeyPath = await ctx.prompt("SSH private key path", "~/.ssh/id_ed25519");
  } else if (authMethod === "jwt") {
    jwtSecret = await ctx.prompt("JWT secret (or env var name)");
  }

  // 4. Agent mode
  const mode = await ctx.select("Agent mode", [
    {
      label: "Multi (per-agent streams)",
      value: "multi",
    },
    {
      label: "Single (internal routing)",
      value: "single",
    },
  ]);

  // 5. Connection test
  ctx.log.info("\nTesting connection...");
  const probe = await probeCoven(
    {
      accountId: "onboarding",
      endpoint,
      mode: mode as ResolvedCovenAccount["mode"],
      agentFilter: [],
      tls,
      authMethod: authMethod as ResolvedCovenAccount["authMethod"],
      sshKeyPath: sshKeyPath ?? "",
      jwtSecret: jwtSecret ?? "",
      jwtToken: "",
      heartbeatIntervalMs: 30000,
      reconnect: { maxAttempts: 1, baseDelayMs: 1000, maxDelayMs: 1000 },
      enabled: true,
    },
    5000
  );

  if (probe.ok) {
    ctx.log.success(`Connected to ${endpoint} (${probe.latencyMs}ms)`);
  } else {
    ctx.log.warn(
      `Could not reach ${endpoint}: ${probe.error}. You can still save the config and connect later.`
    );
  }

  return {
    endpoint,
    authMethod,
    sshKeyPath,
    jwtSecret,
    mode,
    tls,
    connectionTestPassed: probe.ok,
  };
}
