// ABOUTME: Tests for coven agent registration payload building.
// ABOUTME: Validates single-mode and multi-mode registration with correct metadata.

import { describe, it, expect } from "vitest";
import { buildRegistration } from "../src/registration.js";

const baseAccount = {
  accountId: "default",
  endpoint: "localhost:50051",
  mode: "multi" as const,
  agentFilter: [] as string[],
  tls: false,
  authMethod: "ssh" as const,
  sshKeyPath: "~/.ssh/id_ed25519",
  jwtSecret: "",
  heartbeatIntervalMs: 30000,
  reconnect: { maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 60000 },
  enabled: true,
};

describe("buildRegistration", () => {
  it("builds registration for multi-mode agent", () => {
    const reg = buildRegistration({
      account: baseAccount,
      agentName: "code",
    });

    expect(reg.agent_id).toBe("openclaw-code");
    expect(reg.name).toBe("code (OpenClaw)");
    expect(reg.capabilities).toEqual(["chat", "streaming", "files"]);
    expect(reg.protocol_features).toEqual([
      "token_usage",
      "injection",
      "cancellation",
    ]);
    expect(reg.metadata.backend).toBe("openclaw");
  });

  it("builds registration for single-mode", () => {
    const account = { ...baseAccount, mode: "single" as const };
    const reg = buildRegistration({ account, agentName: "openclaw" });

    expect(reg.agent_id).toBe("openclaw-openclaw");
    expect(reg.name).toBe("openclaw (OpenClaw)");
  });

  it("includes hostname and os in metadata", () => {
    const reg = buildRegistration({
      account: baseAccount,
      agentName: "research",
    });

    expect(reg.metadata.hostname).toBeTruthy();
    expect(reg.metadata.os).toBeTruthy();
    expect(reg.metadata.workspaces).toEqual(["openclaw"]);
  });

  it("includes git info when provided", () => {
    const reg = buildRegistration({
      account: baseAccount,
      agentName: "code",
      git: { branch: "main", commit: "abc123", dirty: false },
    });

    expect(reg.metadata.git).toEqual({
      branch: "main",
      commit: "abc123",
      dirty: false,
      remote: "",
      ahead: 0,
      behind: 0,
    });
  });
});
