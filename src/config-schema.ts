// ABOUTME: JSON schema definition for the coven channel configuration.
// ABOUTME: Defines the shape of accounts under channels.coven in openclaw config.

export type CovenAuthMethod = "ssh" | "jwt" | "none";
export type CovenAgentMode = "multi" | "single";

export type CovenReconnectConfig = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export type CovenAccountConfig = {
  endpoint?: string;
  mode?: CovenAgentMode;
  agentFilter?: string[];
  tls?: boolean;
  authMethod?: CovenAuthMethod;
  sshKeyPath?: string;
  jwtSecret?: string;
  heartbeatIntervalMs?: number;
  reconnect?: Partial<CovenReconnectConfig>;
  enabled?: boolean;
};

export type CovenChannelConfig = {
  accounts?: Record<string, CovenAccountConfig>;
};

export const DEFAULT_ENDPOINT = "localhost:50051";
export const DEFAULT_MODE: CovenAgentMode = "multi";
export const DEFAULT_AUTH_METHOD: CovenAuthMethod = "ssh";
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;

export const DEFAULT_RECONNECT: CovenReconnectConfig = {
  maxAttempts: 10,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
};
