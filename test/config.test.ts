// ABOUTME: Tests for coven channel configuration and account resolution.
// ABOUTME: Validates account listing, resolution, defaults, and enable/disable.

import { describe, it, expect } from "vitest";
import {
  listCovenAccountIds,
  resolveCovenAccount,
} from "../src/config.js";

const baseCfg = {
  channels: {
    coven: {
      accounts: {
        default: {
          endpoint: "localhost:50051",
          mode: "multi" as const,
          tls: false,
          authMethod: "ssh" as const,
          sshKeyPath: "~/.ssh/id_ed25519",
        },
        staging: {
          endpoint: "staging.example.com:50051",
          mode: "single" as const,
          tls: true,
          authMethod: "jwt" as const,
          jwtSecret: "test-secret",
          enabled: false,
        },
      },
    },
  },
};

describe("listCovenAccountIds", () => {
  it("lists all account IDs from config", () => {
    const ids = listCovenAccountIds(baseCfg);
    expect(ids).toEqual(["default", "staging"]);
  });

  it("returns empty array when no coven config", () => {
    expect(listCovenAccountIds({})).toEqual([]);
  });

  it("returns empty array when no accounts", () => {
    expect(listCovenAccountIds({ channels: { coven: {} } })).toEqual([]);
  });
});

describe("resolveCovenAccount", () => {
  it("resolves an account by ID", () => {
    const account = resolveCovenAccount(baseCfg, "default");
    expect(account.accountId).toBe("default");
    expect(account.endpoint).toBe("localhost:50051");
    expect(account.mode).toBe("multi");
    expect(account.tls).toBe(false);
    expect(account.authMethod).toBe("ssh");
    expect(account.enabled).toBe(true);
  });

  it("resolves disabled account", () => {
    const account = resolveCovenAccount(baseCfg, "staging");
    expect(account.enabled).toBe(false);
    expect(account.endpoint).toBe("staging.example.com:50051");
    expect(account.authMethod).toBe("jwt");
  });

  it("falls back to default account when no accountId", () => {
    const account = resolveCovenAccount(baseCfg);
    expect(account.accountId).toBe("default");
  });

  it("returns defaults for missing account", () => {
    const account = resolveCovenAccount(baseCfg, "nonexistent");
    expect(account.accountId).toBe("nonexistent");
    expect(account.endpoint).toBe("localhost:50051");
    expect(account.mode).toBe("multi");
    expect(account.enabled).toBe(true);
  });

  it("applies default heartbeat and reconnect config", () => {
    const account = resolveCovenAccount(baseCfg, "default");
    expect(account.heartbeatIntervalMs).toBe(30000);
    expect(account.reconnect.maxAttempts).toBe(10);
    expect(account.reconnect.baseDelayMs).toBe(1000);
    expect(account.reconnect.maxDelayMs).toBe(60000);
  });
});
