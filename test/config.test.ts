// ABOUTME: Tests for coven channel configuration and account resolution.
// ABOUTME: Validates account listing, resolution, defaults, and enable/disable.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listCovenAccountIds,
  resolveCovenAccount,
} from "../src/config.js";
import type { LinkedCovenConfig } from "../src/linked-config.js";

vi.mock("../src/linked-config.js", () => ({
  readLinkedConfig: vi.fn(() => null),
}));

// Import after mock setup so we can control the mock
const { readLinkedConfig } = await import("../src/linked-config.js");

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

  it("returns empty jwtToken by default when no linked config", () => {
    vi.mocked(readLinkedConfig).mockReturnValue(null);
    const account = resolveCovenAccount({}, "default");
    expect(account.jwtToken).toBe("");
  });
});

describe("resolveCovenAccount with linked config fallback", () => {
  const linkedConfig: LinkedCovenConfig = {
    gateway: "linked-gateway.example.com:50051",
    token: "linked-jwt-token-abc123",
    principalId: "b5b00360-1234-5678-9abc-def012345678",
    deviceName: "disaster",
  };

  beforeEach(() => {
    vi.mocked(readLinkedConfig).mockReturnValue(linkedConfig);
  });

  it("uses linked config gateway when no explicit endpoint configured", () => {
    const account = resolveCovenAccount({}, "default");
    expect(account.endpoint).toBe("linked-gateway.example.com:50051");
  });

  it("defaults authMethod to jwt when linked config has a token", () => {
    const account = resolveCovenAccount({}, "default");
    expect(account.authMethod).toBe("jwt");
  });

  it("populates jwtToken from linked config token", () => {
    const account = resolveCovenAccount({}, "default");
    expect(account.jwtToken).toBe("linked-jwt-token-abc123");
  });

  it("does not override explicit endpoint with linked config", () => {
    const cfg = {
      channels: {
        coven: {
          accounts: {
            default: {
              endpoint: "explicit.example.com:50051",
            },
          },
        },
      },
    };
    const account = resolveCovenAccount(cfg, "default");
    expect(account.endpoint).toBe("explicit.example.com:50051");
  });

  it("does not override explicit authMethod with linked config", () => {
    const cfg = {
      channels: {
        coven: {
          accounts: {
            default: {
              authMethod: "ssh" as const,
            },
          },
        },
      },
    };
    const account = resolveCovenAccount(cfg, "default");
    expect(account.authMethod).toBe("ssh");
  });

  it("does not override explicit jwtToken from config with linked config", () => {
    const cfg = {
      channels: {
        coven: {
          accounts: {
            default: {
              jwtToken: "explicit-token-xyz",
            },
          },
        },
      },
    };
    const account = resolveCovenAccount(cfg, "default");
    expect(account.jwtToken).toBe("explicit-token-xyz");
  });

  it("preserves defaults when no linked config exists", () => {
    vi.mocked(readLinkedConfig).mockReturnValue(null);
    const account = resolveCovenAccount({}, "default");
    expect(account.endpoint).toBe("localhost:50051");
    expect(account.authMethod).toBe("ssh");
    expect(account.jwtToken).toBe("");
  });

  it("only calls readLinkedConfig once per resolution", () => {
    vi.mocked(readLinkedConfig).mockClear();
    resolveCovenAccount({}, "default");
    expect(readLinkedConfig).toHaveBeenCalledTimes(1);
  });
});
