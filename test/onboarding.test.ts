// ABOUTME: Tests for the CLI onboarding wizard for coven channel setup.
// ABOUTME: Validates prompt flows, auth method branching, and connection test handling.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OnboardingContext, OnboardingResult } from "../src/onboarding.js";

vi.mock("../src/status.js", () => ({
  probeCoven: vi.fn(),
}));

import { probeCoven } from "../src/status.js";
import { runOnboarding } from "../src/onboarding.js";

const mockedProbeCoven = vi.mocked(probeCoven);

function buildContext(overrides?: {
  promptResponses?: string[];
  selectResponses?: string[];
}): OnboardingContext {
  const promptResponses = [...(overrides?.promptResponses ?? ["localhost:50051"])];
  const selectResponses = [
    ...(overrides?.selectResponses ?? ["false", "ssh", "~/.ssh/id_ed25519", "multi"]),
  ];

  // Track which prompt/select call we're on
  let promptIndex = 0;
  let selectIndex = 0;

  return {
    prompt: vi.fn(async (_message: string, _defaultValue?: string) => {
      return promptResponses[promptIndex++] ?? "";
    }),
    select: vi.fn(async (_message: string, _choices: { label: string; value: string }[]) => {
      return selectResponses[selectIndex++] ?? "";
    }),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    },
  };
}

describe("runOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedProbeCoven.mockResolvedValue({
      ok: true,
      latencyMs: 42,
      serverReachable: true,
    });
  });

  it("collects endpoint, TLS, auth method, and mode", async () => {
    const ctx = buildContext({
      promptResponses: ["my-server:9090"],
      selectResponses: ["true", "none", "single"],
    });

    const result = await runOnboarding(ctx);

    expect(result.endpoint).toBe("my-server:9090");
    expect(result.tls).toBe(true);
    expect(result.authMethod).toBe("none");
    expect(result.mode).toBe("single");
  });

  it("prompts for SSH key path when auth method is ssh", async () => {
    const ctx = buildContext({
      promptResponses: ["localhost:50051", "/custom/key/path"],
      selectResponses: ["false", "ssh", "multi"],
    });

    const result = await runOnboarding(ctx);

    expect(result.authMethod).toBe("ssh");
    expect(result.sshKeyPath).toBe("/custom/key/path");
    expect(result.jwtSecret).toBeUndefined();
    // Two prompts: endpoint + ssh key path
    expect(ctx.prompt).toHaveBeenCalledTimes(2);
  });

  it("prompts for JWT secret when auth method is jwt", async () => {
    const ctx = buildContext({
      promptResponses: ["localhost:50051", "my-jwt-secret-123"],
      selectResponses: ["false", "jwt", "multi"],
    });

    const result = await runOnboarding(ctx);

    expect(result.authMethod).toBe("jwt");
    expect(result.jwtSecret).toBe("my-jwt-secret-123");
    expect(result.sshKeyPath).toBeUndefined();
    // Two prompts: endpoint + jwt secret
    expect(ctx.prompt).toHaveBeenCalledTimes(2);
  });

  it("does not prompt for extra fields when auth method is none", async () => {
    const ctx = buildContext({
      promptResponses: ["localhost:50051"],
      selectResponses: ["false", "none", "multi"],
    });

    const result = await runOnboarding(ctx);

    expect(result.authMethod).toBe("none");
    expect(result.sshKeyPath).toBeUndefined();
    expect(result.jwtSecret).toBeUndefined();
    // Only one prompt: endpoint
    expect(ctx.prompt).toHaveBeenCalledTimes(1);
  });

  it("reports connection test passed when probe succeeds", async () => {
    mockedProbeCoven.mockResolvedValue({
      ok: true,
      latencyMs: 15,
      serverReachable: true,
    });

    const ctx = buildContext({
      promptResponses: ["localhost:50051"],
      selectResponses: ["false", "none", "multi"],
    });

    const result = await runOnboarding(ctx);

    expect(result.connectionTestPassed).toBe(true);
    expect(ctx.log.success).toHaveBeenCalledWith(
      expect.stringContaining("15ms")
    );
  });

  it("reports connection test failed when probe fails", async () => {
    mockedProbeCoven.mockResolvedValue({
      ok: false,
      latencyMs: 5000,
      serverReachable: false,
      error: "Connection refused",
    });

    const ctx = buildContext({
      promptResponses: ["bad-host:9999"],
      selectResponses: ["false", "none", "multi"],
    });

    const result = await runOnboarding(ctx);

    expect(result.connectionTestPassed).toBe(false);
    expect(ctx.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("Connection refused")
    );
  });

  it("logs setup info at the start", async () => {
    const ctx = buildContext({
      promptResponses: ["localhost:50051"],
      selectResponses: ["false", "none", "multi"],
    });

    await runOnboarding(ctx);

    expect(ctx.log.info).toHaveBeenCalledWith(
      expect.stringContaining("Setting up Coven Gateway")
    );
  });

  it("logs testing connection message before probe", async () => {
    const ctx = buildContext({
      promptResponses: ["localhost:50051"],
      selectResponses: ["false", "none", "multi"],
    });

    await runOnboarding(ctx);

    expect(ctx.log.info).toHaveBeenCalledWith(
      expect.stringContaining("Testing connection")
    );
  });

  it("passes correct account config to probeCoven", async () => {
    const ctx = buildContext({
      promptResponses: ["custom:8080"],
      selectResponses: ["true", "none", "single"],
    });

    await runOnboarding(ctx);

    expect(mockedProbeCoven).toHaveBeenCalledTimes(1);
    const [account, timeout] = mockedProbeCoven.mock.calls[0];
    expect(account.endpoint).toBe("custom:8080");
    expect(account.tls).toBe(true);
    expect(account.authMethod).toBe("none");
    expect(account.mode).toBe("single");
    expect(timeout).toBe(5000);
  });

  it("uses default endpoint value when prompt default is accepted", async () => {
    // Simulate user accepting the default by returning the default value
    const ctx = buildContext({
      promptResponses: ["localhost:50051"],
      selectResponses: ["false", "none", "multi"],
    });

    const result = await runOnboarding(ctx);

    expect(result.endpoint).toBe("localhost:50051");
  });

  it("returns all fields in the result object", async () => {
    const ctx = buildContext({
      promptResponses: ["prod.example.com:443", "~/.ssh/id_rsa"],
      selectResponses: ["true", "ssh", "multi"],
    });

    const result = await runOnboarding(ctx);

    expect(result).toEqual({
      endpoint: "prod.example.com:443",
      authMethod: "ssh",
      sshKeyPath: "~/.ssh/id_rsa",
      jwtSecret: undefined,
      mode: "multi",
      tls: true,
      connectionTestPassed: true,
    });
  });
});
