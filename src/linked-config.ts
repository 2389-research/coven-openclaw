// ABOUTME: Reads the linked coven configuration from ~/.config/coven/config.toml.
// ABOUTME: Provides auto-discovery of gateway endpoint, JWT token, and device identity.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type LinkedCovenConfig = {
  gateway: string; // "host:50051" (http:// prefix stripped)
  token: string; // JWT bearer token
  principalId: string; // UUID
  deviceName: string; // hostname
};

const REQUIRED_KEYS = ["gateway", "token", "principal_id", "device_name"];

/**
 * Returns the path to ~/.config/coven/config.toml.
 * Respects XDG_CONFIG_HOME env var if set.
 */
export function getLinkedConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const configBase =
    xdgConfigHome && xdgConfigHome.length > 0
      ? xdgConfigHome
      : path.join(os.homedir(), ".config");
  return path.join(configBase, "coven", "config.toml");
}

/**
 * Strips http:// or https:// prefix from a gateway URL for gRPC use.
 */
function stripProtocolPrefix(gateway: string): string {
  if (gateway.startsWith("https://")) {
    return gateway.slice("https://".length);
  }
  if (gateway.startsWith("http://")) {
    return gateway.slice("http://".length);
  }
  return gateway;
}

/**
 * Parses a flat TOML file using simple string splitting.
 * Each line is expected to be `key = "value"` format.
 * Skips blank lines and comment lines (starting with #).
 */
function parseFlatToml(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    // Skip blank lines and comments
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    // Strip surrounding quotes (double or single)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Reads and parses the linked coven config file.
 * Returns null if the file doesn't exist, can't be read, or is missing required fields.
 * Strips http:// or https:// prefix from gateway for gRPC use.
 */
export function readLinkedConfig(): LinkedCovenConfig | null {
  const configPath = getLinkedConfigPath();

  let content: string;
  try {
    content = fs.readFileSync(configPath, "utf-8");
  } catch {
    return null;
  }

  const parsed = parseFlatToml(content);

  // Validate all required keys are present
  for (const key of REQUIRED_KEYS) {
    if (!(key in parsed) || parsed[key].length === 0) {
      return null;
    }
  }

  return {
    gateway: stripProtocolPrefix(parsed.gateway),
    token: parsed.token,
    principalId: parsed.principal_id,
    deviceName: parsed.device_name,
  };
}
