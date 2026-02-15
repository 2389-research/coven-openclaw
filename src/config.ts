// ABOUTME: Account resolution and config adapter for the coven channel plugin.
// ABOUTME: Lists accounts, resolves account settings with defaults, handles enable/disable.

import {
  DEFAULT_ENDPOINT,
  DEFAULT_MODE,
  DEFAULT_AUTH_METHOD,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_RECONNECT,
  type CovenAgentMode,
  type CovenAuthMethod,
  type CovenReconnectConfig,
  type CovenAccountConfig,
} from "./config-schema.js";

export type ResolvedCovenAccount = {
  accountId: string;
  endpoint: string;
  mode: CovenAgentMode;
  agentFilter: string[];
  tls: boolean;
  authMethod: CovenAuthMethod;
  sshKeyPath: string;
  jwtSecret: string;
  heartbeatIntervalMs: number;
  reconnect: CovenReconnectConfig;
  enabled: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = Record<string, any>;

function getCovenSection(cfg: AnyConfig): AnyConfig | undefined {
  return cfg?.channels?.coven;
}

function getAccountsMap(
  cfg: AnyConfig
): Record<string, CovenAccountConfig> | undefined {
  return getCovenSection(cfg)?.accounts;
}

export function listCovenAccountIds(cfg: AnyConfig): string[] {
  const accounts = getAccountsMap(cfg);
  if (!accounts) return [];
  return Object.keys(accounts);
}

export function resolveCovenAccount(
  cfg: AnyConfig,
  accountId?: string | null
): ResolvedCovenAccount {
  const resolvedId = accountId ?? "default";
  const accounts = getAccountsMap(cfg) ?? {};
  const raw: CovenAccountConfig = accounts[resolvedId] ?? {};

  return {
    accountId: resolvedId,
    endpoint: raw.endpoint ?? DEFAULT_ENDPOINT,
    mode: raw.mode ?? DEFAULT_MODE,
    agentFilter: raw.agentFilter ?? [],
    tls: raw.tls ?? false,
    authMethod: raw.authMethod ?? DEFAULT_AUTH_METHOD,
    sshKeyPath: raw.sshKeyPath ?? "~/.ssh/id_ed25519",
    jwtSecret: raw.jwtSecret ?? "",
    heartbeatIntervalMs: raw.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    reconnect: {
      maxAttempts: raw.reconnect?.maxAttempts ?? DEFAULT_RECONNECT.maxAttempts,
      baseDelayMs: raw.reconnect?.baseDelayMs ?? DEFAULT_RECONNECT.baseDelayMs,
      maxDelayMs: raw.reconnect?.maxDelayMs ?? DEFAULT_RECONNECT.maxDelayMs,
    },
    enabled: raw.enabled ?? true,
  };
}
