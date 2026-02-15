// ABOUTME: Tests for the coven status probe with JWT credential support.
// ABOUTME: Validates probe behavior for unreachable endpoints with various credential configurations.

import { describe, it, expect } from "vitest";
import { probeCoven, type CovenProbeResult } from "../src/status.js";
import type { ResolvedCovenAccount } from "../src/config.js";

function makeAccount(
  overrides: Partial<ResolvedCovenAccount> = {}
): ResolvedCovenAccount {
  return {
    accountId: "test",
    endpoint: "127.0.0.1:1", // port 1 is unreachable on all platforms
    mode: "multi",
    agentFilter: [],
    tls: false,
    authMethod: "ssh",
    sshKeyPath: "~/.ssh/id_ed25519",
    jwtSecret: "",
    jwtToken: "",
    heartbeatIntervalMs: 30000,
    reconnect: {
      maxAttempts: 10,
      baseDelayMs: 1000,
      maxDelayMs: 60000,
    },
    enabled: true,
    ...overrides,
  };
}

describe("probeCoven", () => {
  it("returns error result when server is unreachable (insecure)", async () => {
    const account = makeAccount();
    const result = await probeCoven(account, 500);

    expect(result.ok).toBe(false);
    expect(result.serverReachable).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeDefined();
  });

  it("returns error result when server is unreachable (TLS, no JWT)", async () => {
    const account = makeAccount({ tls: true });
    const result = await probeCoven(account, 500);

    expect(result.ok).toBe(false);
    expect(result.serverReachable).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("handles TLS + JWT credential setup without throwing", async () => {
    const account = makeAccount({
      tls: true,
      jwtToken: "test-jwt-token-abc123",
      authMethod: "jwt",
    });

    // Should not throw — the credential construction should succeed even
    // though the server is unreachable.
    const result = await probeCoven(account, 500);

    expect(result.ok).toBe(false);
    expect(result.serverReachable).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("uses insecure credentials when tls is false even with JWT token", async () => {
    const account = makeAccount({
      tls: false,
      jwtToken: "some-token",
      authMethod: "jwt",
    });

    // Should not throw — insecure + JWT means no combined credentials
    // (gRPC limitation), but the probe still works for connectivity check.
    const result = await probeCoven(account, 500);

    expect(result.ok).toBe(false);
    expect(result.serverReachable).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns latencyMs that reflects actual elapsed time", async () => {
    const account = makeAccount();
    const before = Date.now();
    const result = await probeCoven(account, 500);
    const after = Date.now();

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs).toBeLessThanOrEqual(after - before + 50);
  });

  it("returns a properly typed CovenProbeResult", async () => {
    const account = makeAccount();
    const result: CovenProbeResult = await probeCoven(account, 500);

    expect(result).toHaveProperty("ok");
    expect(result).toHaveProperty("latencyMs");
    expect(result).toHaveProperty("serverReachable");
    expect(typeof result.ok).toBe("boolean");
    expect(typeof result.latencyMs).toBe("number");
    expect(typeof result.serverReachable).toBe("boolean");
  });
});
