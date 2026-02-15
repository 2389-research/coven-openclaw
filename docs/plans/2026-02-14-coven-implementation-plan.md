# Coven Gateway Channel Plugin — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone openclaw channel plugin that connects to coven-gateway via bidirectional gRPC streaming, making openclaw agents available as backends for coven's frontends.

**Architecture:** The plugin is an installable openclaw extension (`openclaw plugins install --link .`). It opens a gRPC `AgentStream` to coven-gateway per account, translates between coven's protobuf protocol and openclaw's internal message format, and dynamically registers coven's MCP endpoint for pack tool access.

**Tech Stack:** TypeScript (ES modules), `@grpc/grpc-js`, `@grpc/proto-loader`, vitest for testing, openclaw plugin SDK for types.

**Reference impl:** Discord plugin at `/Users/harper/workspace/2389/agent-class/agents/openclaw/extensions/discord/`
**Proto source:** `/Users/harper/workspace/2389/fold-project/coven-gateway/proto/coven.proto`
**Design doc:** `docs/2026-02-14-coven-gateway-channel-plugin-design.md`

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `openclaw.plugin.json`
- Create: `tsconfig.json`
- Create: `proto/coven.proto` (vendored copy)

**Step 1: Initialize the project**

Create `package.json`:
```json
{
  "name": "@2389/openclaw-coven",
  "version": "0.1.0",
  "description": "Coven Gateway channel plugin for OpenClaw",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@grpc/grpc-js": "^1.12.0",
    "@grpc/proto-loader": "^0.7.0"
  },
  "devDependencies": {
    "openclaw": "file:../../workspace/2389/agent-class/agents/openclaw",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "openclaw": {
    "extensions": ["./index.ts"],
    "channel": {
      "id": "coven",
      "label": "Coven Gateway",
      "selectionLabel": "Coven Gateway (gRPC)",
      "docsPath": "/channels/coven",
      "order": 90
    },
    "install": {
      "npmSpec": "@2389/openclaw-coven",
      "defaultChoice": "npm"
    }
  }
}
```

**Step 2: Create the plugin manifest**

Create `openclaw.plugin.json`:
```json
{
  "id": "coven",
  "name": "Coven Gateway",
  "description": "Connect openclaw agents to coven-gateway via gRPC AgentStream",
  "channels": ["coven"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["index.ts", "src/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Vendor the proto file**

Copy `coven.proto` from `/Users/harper/workspace/2389/fold-project/coven-gateway/proto/coven.proto` to `proto/coven.proto`. Add a comment at the top noting the source commit.

**Step 5: Install dependencies**

Run: `npm install` (or use the package manager of choice)

**Step 6: Verify project structure**

Run: `ls -la package.json openclaw.plugin.json tsconfig.json proto/coven.proto`
Expected: All four files exist.

**Step 7: Commit**

```bash
git add package.json openclaw.plugin.json tsconfig.json proto/coven.proto
git commit -m "feat: scaffold coven gateway channel plugin"
```

---

## Task 2: Session Key Normalization (`normalize.ts`)

**Files:**
- Create: `test/normalize.test.ts`
- Create: `src/normalize.ts`

Session keys follow the pattern `coven:{accountId}:{threadId}`.

**Step 1: Write failing tests**

Create `test/normalize.test.ts`:
```typescript
// ABOUTME: Tests for coven session key normalization.
// ABOUTME: Validates parsing and formatting of "coven:{accountId}:{threadId}" keys.

import { describe, it, expect } from "vitest";
import {
  formatSessionKey,
  parseSessionKey,
  normalizeCovenTarget,
} from "../src/normalize.js";

describe("formatSessionKey", () => {
  it("formats a session key from accountId and threadId", () => {
    expect(formatSessionKey("default", "thread-123")).toBe(
      "coven:default:thread-123"
    );
  });

  it("handles multi-segment thread IDs", () => {
    expect(formatSessionKey("prod", "room:abc:456")).toBe(
      "coven:prod:room:abc:456"
    );
  });
});

describe("parseSessionKey", () => {
  it("parses a valid session key", () => {
    const result = parseSessionKey("coven:default:thread-123");
    expect(result).toEqual({ accountId: "default", threadId: "thread-123" });
  });

  it("parses session key with multi-segment threadId", () => {
    const result = parseSessionKey("coven:prod:room:abc:456");
    expect(result).toEqual({ accountId: "prod", threadId: "room:abc:456" });
  });

  it("returns null for non-coven keys", () => {
    expect(parseSessionKey("discord:default:123")).toBeNull();
  });

  it("returns null for malformed keys (missing threadId)", () => {
    expect(parseSessionKey("coven:default")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSessionKey("")).toBeNull();
  });
});

describe("normalizeCovenTarget", () => {
  it("passes through valid coven session keys", () => {
    expect(normalizeCovenTarget("coven:default:thread-123")).toBe(
      "coven:default:thread-123"
    );
  });

  it("returns undefined for non-coven targets", () => {
    expect(normalizeCovenTarget("discord:foo:bar")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(normalizeCovenTarget("")).toBeUndefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/normalize.test.ts`
Expected: FAIL — module `../src/normalize.js` not found.

**Step 3: Write implementation**

Create `src/normalize.ts`:
```typescript
// ABOUTME: Session key normalization for coven channel targets.
// ABOUTME: Handles "coven:{accountId}:{threadId}" format parsing and formatting.

const COVEN_PREFIX = "coven:";

export type ParsedSessionKey = {
  accountId: string;
  threadId: string;
};

export function formatSessionKey(
  accountId: string,
  threadId: string
): string {
  return `${COVEN_PREFIX}${accountId}:${threadId}`;
}

export function parseSessionKey(raw: string): ParsedSessionKey | null {
  if (!raw.startsWith(COVEN_PREFIX)) {
    return null;
  }

  const rest = raw.slice(COVEN_PREFIX.length);
  const colonIndex = rest.indexOf(":");
  if (colonIndex < 0) {
    return null;
  }

  const accountId = rest.slice(0, colonIndex);
  const threadId = rest.slice(colonIndex + 1);

  if (!accountId || !threadId) {
    return null;
  }

  return { accountId, threadId };
}

export function normalizeCovenTarget(raw: string): string | undefined {
  const parsed = parseSessionKey(raw);
  if (!parsed) {
    return undefined;
  }
  return raw;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/normalize.test.ts`
Expected: All 8 tests PASS.

**Step 5: Commit**

```bash
git add src/normalize.ts test/normalize.test.ts
git commit -m "feat: add session key normalization"
```

---

## Task 3: Config Schema & Account Resolution (`config-schema.ts`, `config.ts`)

**Files:**
- Create: `test/config.test.ts`
- Create: `src/config-schema.ts`
- Create: `src/config.ts`

**Step 1: Write failing tests**

Create `test/config.test.ts`:
```typescript
// ABOUTME: Tests for coven channel configuration and account resolution.
// ABOUTME: Validates account listing, resolution, defaults, and enable/disable.

import { describe, it, expect } from "vitest";
import {
  listCovenAccountIds,
  resolveCovenAccount,
  type ResolvedCovenAccount,
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
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — module not found.

**Step 3: Write config-schema.ts**

Create `src/config-schema.ts`:
```typescript
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
```

**Step 4: Write config.ts**

Create `src/config.ts`:
```typescript
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
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run test/config.test.ts`
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add src/config-schema.ts src/config.ts test/config.test.ts
git commit -m "feat: add coven config schema and account resolution"
```

---

## Task 4: Agent Registration (`registration.ts`)

**Files:**
- Create: `test/registration.test.ts`
- Create: `src/registration.ts`

**Step 1: Write failing tests**

Create `test/registration.test.ts`:
```typescript
// ABOUTME: Tests for coven agent registration payload building.
// ABOUTME: Validates single-mode and multi-mode registration with correct metadata.

import { describe, it, expect, vi } from "vitest";
import { buildRegistration } from "../src/registration.js";
import type { ResolvedCovenAccount } from "../src/config.js";

const baseAccount: ResolvedCovenAccount = {
  accountId: "default",
  endpoint: "localhost:50051",
  mode: "multi",
  agentFilter: [],
  tls: false,
  authMethod: "ssh",
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
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/registration.test.ts`
Expected: FAIL.

**Step 3: Write implementation**

Create `src/registration.ts`:
```typescript
// ABOUTME: Builds the RegisterAgent payload for coven-gateway registration.
// ABOUTME: Populates agent metadata, capabilities, and protocol features.

import os from "node:os";
import type { ResolvedCovenAccount } from "./config.js";

export type GitInfo = {
  branch: string;
  commit: string;
  dirty: boolean;
  remote?: string;
  ahead?: number;
  behind?: number;
};

export type RegistrationParams = {
  account: ResolvedCovenAccount;
  agentName: string;
  workingDirectory?: string;
  git?: GitInfo;
};

export type RegisterAgentPayload = {
  agent_id: string;
  name: string;
  capabilities: string[];
  metadata: {
    working_directory: string;
    git: {
      branch: string;
      commit: string;
      dirty: boolean;
      remote: string;
      ahead: number;
      behind: number;
    };
    hostname: string;
    os: string;
    workspaces: string[];
    backend: string;
  };
  protocol_features: string[];
};

export function buildRegistration(
  params: RegistrationParams
): RegisterAgentPayload {
  const { account, agentName, workingDirectory, git } = params;

  return {
    agent_id: `openclaw-${agentName}`,
    name: `${agentName} (OpenClaw)`,
    capabilities: ["chat", "streaming", "files"],
    metadata: {
      working_directory: workingDirectory ?? process.cwd(),
      git: {
        branch: git?.branch ?? "",
        commit: git?.commit ?? "",
        dirty: git?.dirty ?? false,
        remote: git?.remote ?? "",
        ahead: git?.ahead ?? 0,
        behind: git?.behind ?? 0,
      },
      hostname: os.hostname(),
      os: process.platform,
      workspaces: ["openclaw"],
      backend: "openclaw",
    },
    protocol_features: ["token_usage", "injection", "cancellation"],
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/registration.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/registration.ts test/registration.test.ts
git commit -m "feat: add agent registration payload builder"
```

---

## Task 5: Protocol Translation (`protocol.ts`)

**Files:**
- Create: `test/protocol.test.ts`
- Create: `src/protocol.ts`

This is the core translation layer. Pure functions, no side effects.

**Step 1: Write failing tests**

Create `test/protocol.test.ts`:
```typescript
// ABOUTME: Tests for protocol translation between coven protobuf and openclaw messages.
// ABOUTME: Validates round-trip translation for all event types.

import { describe, it, expect } from "vitest";
import {
  covenSendMessageToInbound,
  openclawEventToMessageResponse,
  type OpenClawStreamEvent,
} from "../src/protocol.js";

describe("covenSendMessageToInbound", () => {
  it("translates a basic SendMessage to inbound format", () => {
    const msg = {
      request_id: "req-1",
      thread_id: "thread-abc",
      sender: "user@example.com",
      content: "Hello agent",
      attachments: [],
    };

    const result = covenSendMessageToInbound(msg, "default");

    expect(result.sessionKey).toBe("coven:default:thread-abc");
    expect(result.requestId).toBe("req-1");
    expect(result.sender).toBe("user@example.com");
    expect(result.content).toBe("Hello agent");
    expect(result.attachments).toEqual([]);
  });

  it("translates attachments", () => {
    const msg = {
      request_id: "req-2",
      thread_id: "thread-xyz",
      sender: "admin",
      content: "Check this file",
      attachments: [
        {
          filename: "test.png",
          mime_type: "image/png",
          data: Buffer.from("fake-image-data"),
        },
      ],
    };

    const result = covenSendMessageToInbound(msg, "default");

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].filename).toBe("test.png");
    expect(result.attachments[0].mimeType).toBe("image/png");
    expect(result.attachments[0].data).toBeInstanceOf(Buffer);
  });
});

describe("openclawEventToMessageResponse", () => {
  it("translates thinking event", () => {
    const event: OpenClawStreamEvent = { type: "thinking", content: "Let me think..." };
    const response = openclawEventToMessageResponse(event, "req-1");

    expect(response.request_id).toBe("req-1");
    expect(response.thinking).toBe("Let me think...");
  });

  it("translates text event", () => {
    const event: OpenClawStreamEvent = { type: "text", content: "Here is the answer." };
    const response = openclawEventToMessageResponse(event, "req-1");

    expect(response.request_id).toBe("req-1");
    expect(response.text).toBe("Here is the answer.");
  });

  it("translates done event", () => {
    const event: OpenClawStreamEvent = {
      type: "done",
      fullResponse: "Complete response here.",
    };
    const response = openclawEventToMessageResponse(event, "req-1");

    expect(response.request_id).toBe("req-1");
    expect(response.done).toEqual({ full_response: "Complete response here." });
  });

  it("translates error event", () => {
    const event: OpenClawStreamEvent = { type: "error", message: "Something broke" };
    const response = openclawEventToMessageResponse(event, "req-1");

    expect(response.request_id).toBe("req-1");
    expect(response.error).toBe("Something broke");
  });

  it("translates file event", () => {
    const event: OpenClawStreamEvent = {
      type: "file",
      filename: "output.txt",
      mimeType: "text/plain",
      data: Buffer.from("file contents"),
    };
    const response = openclawEventToMessageResponse(event, "req-1");

    expect(response.request_id).toBe("req-1");
    expect(response.file).toEqual({
      filename: "output.txt",
      mime_type: "text/plain",
      data: Buffer.from("file contents"),
    });
  });

  it("translates usage event", () => {
    const event: OpenClawStreamEvent = {
      type: "usage",
      inputTokens: 100,
      outputTokens: 50,
    };
    const response = openclawEventToMessageResponse(event, "req-1");

    expect(response.request_id).toBe("req-1");
    expect(response.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      thinking_tokens: 0,
    });
  });

  it("translates cancelled event", () => {
    const event: OpenClawStreamEvent = { type: "cancelled", reason: "user_requested" };
    const response = openclawEventToMessageResponse(event, "req-1");

    expect(response.request_id).toBe("req-1");
    expect(response.cancelled).toEqual({ reason: "user_requested" });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/protocol.test.ts`
Expected: FAIL.

**Step 3: Write implementation**

Create `src/protocol.ts`:
```typescript
// ABOUTME: Pure translation functions between coven protobuf messages and openclaw format.
// ABOUTME: No side effects — converts inbound SendMessage and outbound stream events.

import { formatSessionKey } from "./normalize.js";

// --- Inbound types (coven → openclaw) ---

export type CovenSendMessage = {
  request_id: string;
  thread_id: string;
  sender: string;
  content: string;
  attachments: CovenFileAttachment[];
};

export type CovenFileAttachment = {
  filename: string;
  mime_type: string;
  data: Buffer | Uint8Array;
};

export type InboundMessage = {
  sessionKey: string;
  requestId: string;
  sender: string;
  content: string;
  attachments: InboundAttachment[];
};

export type InboundAttachment = {
  filename: string;
  mimeType: string;
  data: Buffer;
};

export function covenSendMessageToInbound(
  msg: CovenSendMessage,
  accountId: string
): InboundMessage {
  return {
    sessionKey: formatSessionKey(accountId, msg.thread_id),
    requestId: msg.request_id,
    sender: msg.sender,
    content: msg.content,
    attachments: (msg.attachments ?? []).map((att) => ({
      filename: att.filename,
      mimeType: att.mime_type,
      data: Buffer.isBuffer(att.data) ? att.data : Buffer.from(att.data),
    })),
  };
}

// --- Outbound types (openclaw → coven) ---

export type OpenClawStreamEvent =
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  | { type: "done"; fullResponse: string }
  | { type: "error"; message: string }
  | { type: "file"; filename: string; mimeType: string; data: Buffer }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      thinkingTokens?: number;
    }
  | { type: "cancelled"; reason: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessageResponsePayload = Record<string, any> & {
  request_id: string;
};

export function openclawEventToMessageResponse(
  event: OpenClawStreamEvent,
  requestId: string
): MessageResponsePayload {
  const base = { request_id: requestId };

  switch (event.type) {
    case "thinking":
      return { ...base, thinking: event.content };

    case "text":
      return { ...base, text: event.content };

    case "done":
      return { ...base, done: { full_response: event.fullResponse } };

    case "error":
      return { ...base, error: event.message };

    case "file":
      return {
        ...base,
        file: {
          filename: event.filename,
          mime_type: event.mimeType,
          data: event.data,
        },
      };

    case "usage":
      return {
        ...base,
        usage: {
          input_tokens: event.inputTokens,
          output_tokens: event.outputTokens,
          cache_read_tokens: event.cacheReadTokens ?? 0,
          cache_write_tokens: event.cacheWriteTokens ?? 0,
          thinking_tokens: event.thinkingTokens ?? 0,
        },
      };

    case "cancelled":
      return { ...base, cancelled: { reason: event.reason } };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/protocol.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/protocol.ts test/protocol.test.ts
git commit -m "feat: add protocol translation layer"
```

---

## Task 6: gRPC Client (`grpc-client.ts`)

**Files:**
- Create: `src/grpc-client.ts`
- Create: `test/integration/lifecycle.test.ts`

This is the most complex module — manages the bidirectional gRPC stream with reconnection and heartbeat.

**Step 1: Write the integration test with a mock gRPC server**

Create `test/integration/lifecycle.test.ts`:
```typescript
// ABOUTME: Integration tests for gRPC client lifecycle using a mock server.
// ABOUTME: Tests connect, welcome, heartbeat, disconnect, and reconnect flows.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CovenGrpcClient } from "../../src/grpc-client.js";
import type { ResolvedCovenAccount } from "../../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__dirname, "../../proto/coven.proto");

function loadProto() {
  const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(packageDef) as any;
}

function makeAccount(port: number): ResolvedCovenAccount {
  return {
    accountId: "test",
    endpoint: `localhost:${port}`,
    mode: "multi",
    agentFilter: [],
    tls: false,
    authMethod: "none",
    sshKeyPath: "",
    jwtSecret: "",
    heartbeatIntervalMs: 500, // fast for testing
    reconnect: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 500 },
    enabled: true,
  };
}

describe("CovenGrpcClient lifecycle", () => {
  let server: grpc.Server;
  let port: number;
  let streams: any[];

  beforeEach(async () => {
    streams = [];
    const proto = loadProto();
    server = new grpc.Server();

    server.addService(proto.coven.CovenControl.service, {
      AgentStream: (call: any) => {
        streams.push(call);

        call.on("data", (msg: any) => {
          if (msg.register) {
            call.write({
              welcome: {
                server_id: "test-server",
                agent_id: msg.register.agent_id,
                instance_id: "inst-1",
                principal_id: "princ-1",
                available_tools: [],
                mcp_token: "",
                mcp_endpoint: "",
                secrets: {},
              },
            });
          }
        });

        call.on("end", () => call.end());
      },
    });

    port = await new Promise<number>((resolve, reject) => {
      server.bindAsync(
        "localhost:0",
        grpc.ServerCredentials.createInsecure(),
        (err, boundPort) => {
          if (err) return reject(err);
          resolve(boundPort);
        }
      );
    });
  });

  afterEach(async () => {
    server.forceShutdown();
  });

  it("connects and receives Welcome", async () => {
    const client = new CovenGrpcClient(makeAccount(port));
    const welcome = await client.connect("test-agent");

    expect(welcome.server_id).toBe("test-server");
    expect(welcome.agent_id).toBe("openclaw-test-agent");

    await client.disconnect();
  });

  it("sends heartbeat messages", async () => {
    const client = new CovenGrpcClient(makeAccount(port));
    await client.connect("test-agent");

    // Wait for at least one heartbeat
    await new Promise((r) => setTimeout(r, 700));

    const receivedMessages: any[] = [];
    // The stream should have received heartbeat messages
    // We verify via the client's heartbeat count
    expect(client.heartbeatsSent).toBeGreaterThan(0);

    await client.disconnect();
  });

  it("handles graceful disconnect", async () => {
    const client = new CovenGrpcClient(makeAccount(port));
    await client.connect("test-agent");
    await client.disconnect();

    expect(client.connected).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/lifecycle.test.ts`
Expected: FAIL — `CovenGrpcClient` not found.

**Step 3: Write the gRPC client**

Create `src/grpc-client.ts`:
```typescript
// ABOUTME: gRPC stream management for the coven-gateway AgentStream connection.
// ABOUTME: Handles connect, disconnect, reconnect with exponential backoff, and heartbeat.

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import type { ResolvedCovenAccount } from "./config.js";
import { buildRegistration, type RegistrationParams } from "./registration.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__dirname, "../proto/coven.proto");

export const PROTO_VERSION = "2026-02-14";

export type CovenWelcome = {
  server_id: string;
  agent_id: string;
  instance_id: string;
  principal_id: string;
  available_tools: unknown[];
  mcp_token: string;
  mcp_endpoint: string;
  secrets: Record<string, string>;
};

type ProtoDefinition = ReturnType<typeof grpc.loadPackageDefinition>;

function loadProtoDefinition(): ProtoDefinition {
  const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(packageDef);
}

let cachedProto: ProtoDefinition | null = null;

function getProto(): ProtoDefinition {
  if (!cachedProto) {
    cachedProto = loadProtoDefinition();
  }
  return cachedProto;
}

export class CovenGrpcClient extends EventEmitter {
  private account: ResolvedCovenAccount;
  private grpcClient: any = null;
  private stream: any = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private _heartbeatsSent = 0;
  private _agentName: string | null = null;
  private abortController: AbortController | null = null;

  constructor(account: ResolvedCovenAccount) {
    super();
    this.account = account;
  }

  get connected(): boolean {
    return this._connected;
  }

  get heartbeatsSent(): number {
    return this._heartbeatsSent;
  }

  async connect(agentName: string, registrationOverrides?: Partial<RegistrationParams>): Promise<CovenWelcome> {
    this._agentName = agentName;
    this.abortController = new AbortController();

    const proto = getProto() as any;
    const credentials = this.account.tls
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure();

    this.grpcClient = new proto.coven.CovenControl(
      this.account.endpoint,
      credentials
    );

    this.stream = this.grpcClient.AgentStream();

    return new Promise<CovenWelcome>((resolve, reject) => {
      const registration = buildRegistration({
        account: this.account,
        agentName,
        ...registrationOverrides,
      });

      const timeoutId = setTimeout(() => {
        reject(new Error("Registration timed out waiting for Welcome"));
      }, 10000);

      const onData = (msg: any) => {
        if (msg.welcome) {
          clearTimeout(timeoutId);
          this.stream.removeListener("data", onData);
          this._connected = true;
          this.startHeartbeat();
          this.attachStreamHandlers();
          resolve(msg.welcome);
        } else if (msg.registration_error) {
          clearTimeout(timeoutId);
          this.stream.removeListener("data", onData);
          reject(
            new Error(
              `Registration rejected: ${msg.registration_error.reason}`
            )
          );
        }
      };

      this.stream.on("data", onData);

      this.stream.on("error", (err: Error) => {
        clearTimeout(timeoutId);
        reject(err);
      });

      this.stream.write({ register: registration });
    });
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this._connected = false;

    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }

    if (this.grpcClient) {
      this.grpcClient.close();
      this.grpcClient = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  send(message: Record<string, unknown>): void {
    if (!this.stream) {
      throw new Error("Not connected — call connect() first");
    }
    this.stream.write(message);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this._connected && this.stream) {
        this.stream.write({
          heartbeat: { timestamp_ms: Date.now() },
        });
        this._heartbeatsSent++;
      }
    }, this.account.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private attachStreamHandlers(): void {
    if (!this.stream) return;

    this.stream.on("data", (msg: any) => {
      const payload = msg.payload;
      if (msg.send_message) {
        this.emit("send_message", msg.send_message);
      } else if (msg.inject_context) {
        this.emit("inject_context", msg.inject_context);
      } else if (msg.cancel_request) {
        this.emit("cancel_request", msg.cancel_request);
      } else if (msg.shutdown) {
        this.emit("shutdown", msg.shutdown);
      } else if (msg.tool_approval) {
        this.emit("tool_approval", msg.tool_approval);
      } else if (msg.pack_tool_result) {
        this.emit("pack_tool_result", msg.pack_tool_result);
      }
    });

    this.stream.on("error", (err: Error) => {
      this._connected = false;
      this.stopHeartbeat();
      this.emit("error", err);
    });

    this.stream.on("end", () => {
      this._connected = false;
      this.stopHeartbeat();
      this.emit("disconnected");
    });
  }

  async reconnect(): Promise<CovenWelcome | null> {
    const { maxAttempts, baseDelayMs, maxDelayMs } = this.account.reconnect;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs
      );

      await new Promise((r) => setTimeout(r, delay));

      try {
        if (this.grpcClient) {
          this.grpcClient.close();
          this.grpcClient = null;
        }

        if (!this._agentName) {
          throw new Error("Cannot reconnect: no agent name from initial connect");
        }

        const welcome = await this.connect(this._agentName);
        this.emit("reconnected", welcome);
        return welcome;
      } catch (err) {
        this.emit("reconnect_attempt", { attempt, maxAttempts, error: err });
        if (attempt === maxAttempts) {
          this.emit("reconnect_failed", err);
          return null;
        }
      }
    }

    return null;
  }
}
```

**Step 4: Run integration tests**

Run: `npx vitest run test/integration/lifecycle.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/grpc-client.ts test/integration/lifecycle.test.ts
git commit -m "feat: add gRPC client with connect, heartbeat, and reconnect"
```

---

## Task 7: Runtime, Entry Point, and Channel Wiring

**Files:**
- Create: `src/runtime.ts`
- Create: `index.ts`
- Create: `src/channel.ts`
- Create: `src/status.ts`
- Create: `src/mcp-bridge.ts`

**Step 1: Create runtime.ts**

```typescript
// ABOUTME: Runtime getter/setter for accessing openclaw's PluginRuntime.
// ABOUTME: Injected during plugin registration, accessed by all coven modules.

import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setCovenRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getCovenRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Coven runtime not initialized");
  }
  return runtime;
}
```

**Step 2: Create status.ts**

```typescript
// ABOUTME: Status adapter for coven channel — probe and snapshot builders.
// ABOUTME: Probes gRPC connectivity; builds account status snapshots.

import * as grpc from "@grpc/grpc-js";
import type { ResolvedCovenAccount } from "./config.js";

export type CovenProbeResult = {
  ok: boolean;
  latencyMs: number;
  serverReachable: boolean;
  error?: string;
};

export async function probeCoven(
  account: ResolvedCovenAccount,
  timeoutMs: number
): Promise<CovenProbeResult> {
  const start = Date.now();

  const credentials = account.tls
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure();

  return new Promise<CovenProbeResult>((resolve) => {
    const client = new grpc.Client(account.endpoint, credentials);

    const deadline = new Date(Date.now() + timeoutMs);

    client.waitForReady(deadline, (err) => {
      const latencyMs = Date.now() - start;
      client.close();

      if (err) {
        resolve({
          ok: false,
          latencyMs,
          serverReachable: false,
          error: err.message,
        });
      } else {
        resolve({
          ok: true,
          latencyMs,
          serverReachable: true,
        });
      }
    });
  });
}
```

**Step 3: Create mcp-bridge.ts**

```typescript
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

  // Store the state for tracking
  bridgeState = {
    registered: true,
    endpoint: welcome.mcp_endpoint,
  };

  // Registration with the actual openclaw MCP infrastructure happens
  // through the PluginRuntime — this will be wired in channel.ts when
  // the runtime is available.
}

export function unregisterCovenMcp(): void {
  bridgeState = {
    registered: false,
    endpoint: null,
  };
}
```

**Step 4: Create channel.ts — the main adapter wiring**

```typescript
// ABOUTME: ChannelPlugin definition wiring all coven adapters together.
// ABOUTME: Follows the same pattern as openclaw's Discord channel plugin.

import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { getCovenRuntime } from "./runtime.js";
import {
  listCovenAccountIds,
  resolveCovenAccount,
  type ResolvedCovenAccount,
} from "./config.js";
import { normalizeCovenTarget } from "./normalize.js";
import { formatSessionKey } from "./normalize.js";
import { CovenGrpcClient, type CovenWelcome } from "./grpc-client.js";
import { covenSendMessageToInbound, openclawEventToMessageResponse } from "./protocol.js";
import { probeCoven, type CovenProbeResult } from "./status.js";
import { registerCovenMcp, unregisterCovenMcp } from "./mcp-bridge.js";

// Track active gRPC clients per account
const activeClients = new Map<string, CovenGrpcClient>();

export const covenPlugin: ChannelPlugin<ResolvedCovenAccount, CovenProbeResult> = {
  id: "coven" as any,

  meta: {
    id: "coven" as any,
    label: "Coven Gateway",
    selectionLabel: "Coven Gateway (gRPC)",
    docsPath: "/channels/coven",
    blurb: "Connect openclaw agents to coven-gateway via gRPC AgentStream.",
    order: 90,
  },

  capabilities: {
    chatTypes: ["direct", "thread"],
    media: true,
  },

  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 1500, idleMs: 1000 },
  },

  reload: { configPrefixes: ["channels.coven"] },

  config: {
    listAccountIds: (cfg) => listCovenAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveCovenAccount(cfg, accountId),
    defaultAccountId: () => "default",
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const next = structuredClone(cfg);
      if (!next.channels) next.channels = {};
      if (!next.channels.coven) next.channels.coven = {};
      if (!next.channels.coven.accounts) next.channels.coven.accounts = {};
      if (!next.channels.coven.accounts[accountId]) {
        next.channels.coven.accounts[accountId] = {};
      }
      next.channels.coven.accounts[accountId].enabled = enabled;
      return next;
    },
    isConfigured: (account) => Boolean(account.endpoint?.trim()),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: `coven-${account.accountId}`,
      enabled: account.enabled,
      configured: Boolean(account.endpoint?.trim()),
    }),
  },

  messaging: {
    normalizeTarget: normalizeCovenTarget,
    targetResolver: {
      looksLikeId: (raw) => raw.startsWith("coven:"),
      hint: "coven:<accountId>:<threadId>",
    },
  },

  heartbeat: {
    checkReady: async ({ cfg, accountId }) => {
      const account = resolveCovenAccount(cfg, accountId);
      const client = activeClients.get(account.accountId);
      if (!client || !client.connected) {
        return { ok: false, reason: "coven-not-connected" };
      }
      return { ok: true, reason: "ok" };
    },
  },

  status: {
    defaultRuntime: {
      accountId: "default",
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    probeAccount: async ({ account, timeoutMs }) =>
      probeCoven(account, timeoutMs),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: `coven-${account.accountId}`,
      enabled: account.enabled,
      configured: Boolean(account.endpoint?.trim()),
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      probe,
    }),
  },

  outbound: {
    deliveryMode: "direct",
    chunker: null,
    textChunkLimit: 4000,
    sendText: async ({ to, text }) => {
      // "to" is a session key like "coven:default:thread-123"
      // We need to find the right gRPC client and send a MessageResponse
      const parts = to.split(":");
      if (parts.length < 3 || parts[0] !== "coven") {
        throw new Error(`Invalid coven target: ${to}`);
      }
      const accountId = parts[1];
      const client = activeClients.get(accountId);
      if (!client || !client.connected) {
        throw new Error(`No active coven connection for account: ${accountId}`);
      }

      // For outbound text, we send it as a MessageResponse.text
      // The request_id should be tracked from the inbound message context
      client.send({
        response: {
          request_id: "", // Will be set by the gateway handler context
          text,
        },
      });

      return {
        channel: "coven" as any,
        messageId: `coven-${Date.now()}`,
      };
    },
    sendMedia: async ({ to, text, mediaUrl }) => {
      // Media sending through coven
      const parts = to.split(":");
      const accountId = parts[1] ?? "default";
      const client = activeClients.get(accountId);
      if (!client || !client.connected) {
        throw new Error(`No active coven connection for account: ${accountId}`);
      }

      return {
        channel: "coven" as any,
        messageId: `coven-${Date.now()}`,
      };
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const agentName = account.mode === "single" ? "openclaw" : "default";

      ctx.log?.info?.(
        `[${account.accountId}] connecting to coven-gateway at ${account.endpoint}`
      );

      const client = new CovenGrpcClient(account);
      activeClients.set(account.accountId, client);

      try {
        const welcome = await client.connect(agentName);
        ctx.log?.info?.(
          `[${account.accountId}] registered as ${welcome.agent_id} (instance: ${welcome.instance_id})`
        );

        // Register MCP endpoint if provided
        if (welcome.mcp_endpoint && welcome.mcp_token) {
          registerCovenMcp(welcome);
          ctx.log?.info?.(
            `[${account.accountId}] MCP bridge registered at ${welcome.mcp_endpoint}`
          );
        }

        // Handle incoming messages
        client.on("send_message", (msg: any) => {
          const inbound = covenSendMessageToInbound(msg, account.accountId);
          ctx.log?.info?.(
            `[${account.accountId}] inbound message: ${inbound.requestId} from ${inbound.sender}`
          );
          // Dispatch into openclaw's message pipeline
          // ctx.gateway.handleChannelMessage(inbound) — wired by openclaw runtime
        });

        // Handle context injection
        client.on("inject_context", (msg: any) => {
          ctx.log?.info?.(
            `[${account.accountId}] context injection: ${msg.injection_id}`
          );
          // Acknowledge
          client.send({
            injection_ack: {
              injection_id: msg.injection_id,
              accepted: true,
            },
          });
        });

        // Handle cancellation
        client.on("cancel_request", (msg: any) => {
          ctx.log?.info?.(
            `[${account.accountId}] cancel request: ${msg.request_id}`
          );
          // Send cancelled acknowledgment
          client.send({
            response: {
              request_id: msg.request_id,
              cancelled: { reason: msg.reason ?? "server_requested" },
            },
          });
        });

        // Handle shutdown
        client.on("shutdown", (msg: any) => {
          ctx.log?.warn?.(
            `[${account.accountId}] server shutdown: ${msg.reason}`
          );
          client.disconnect();
        });

        // Handle disconnection with auto-reconnect
        client.on("disconnected", async () => {
          ctx.log?.warn?.(
            `[${account.accountId}] disconnected, attempting reconnect...`
          );
          unregisterCovenMcp();
          const newWelcome = await client.reconnect();
          if (newWelcome) {
            ctx.log?.info?.(
              `[${account.accountId}] reconnected as ${newWelcome.agent_id}`
            );
            if (newWelcome.mcp_endpoint && newWelcome.mcp_token) {
              registerCovenMcp(newWelcome);
            }
          } else {
            ctx.log?.error?.(
              `[${account.accountId}] reconnection failed after max attempts`
            );
          }
        });

        client.on("error", (err: Error) => {
          ctx.log?.error?.(
            `[${account.accountId}] gRPC error: ${err.message}`
          );
        });
      } catch (err) {
        activeClients.delete(account.accountId);
        throw err;
      }

      // Return a cleanup function for when the account stops
      return () => {
        const c = activeClients.get(account.accountId);
        if (c) {
          c.disconnect();
          activeClients.delete(account.accountId);
          unregisterCovenMcp();
        }
      };
    },
  },
};
```

**Step 5: Create the plugin entry point**

Create `index.ts`:
```typescript
// ABOUTME: Plugin entry point for the coven-gateway channel plugin.
// ABOUTME: Registers the coven channel with openclaw's plugin system.

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { covenPlugin } from "./src/channel.js";
import { setCovenRuntime } from "./src/runtime.js";

const plugin = {
  id: "coven",
  name: "Coven Gateway",
  description: "Connect openclaw agents to coven-gateway via gRPC AgentStream",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setCovenRuntime(api.runtime);
    api.registerChannel({ plugin: covenPlugin });
  },
};

export default plugin;
```

**Step 6: Run all tests**

Run: `npx vitest run`
Expected: All unit and integration tests PASS.

**Step 7: Commit**

```bash
git add src/runtime.ts src/status.ts src/mcp-bridge.ts src/channel.ts index.ts
git commit -m "feat: add channel plugin wiring, status, MCP bridge, and entry point"
```

---

## Task 8: Onboarding Wizard (`onboarding.ts`)

**Files:**
- Create: `src/onboarding.ts`

The onboarding adapter provides a CLI wizard for `openclaw channel add coven`.

**Step 1: Write the onboarding adapter**

Create `src/onboarding.ts`:
```typescript
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
      mode: mode as any,
      agentFilter: [],
      tls,
      authMethod: authMethod as any,
      sshKeyPath: sshKeyPath ?? "",
      jwtSecret: jwtSecret ?? "",
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
```

**Step 2: Commit**

```bash
git add src/onboarding.ts
git commit -m "feat: add onboarding wizard for coven channel setup"
```

---

## Task 9: End-to-End Integration Test

**Files:**
- Update: `test/integration/lifecycle.test.ts`

Add more comprehensive tests: message round-trip, cancellation, context injection.

**Step 1: Add message round-trip test**

Extend `test/integration/lifecycle.test.ts` with:
```typescript
it("handles SendMessage and emits event", async () => {
  const client = new CovenGrpcClient(makeAccount(port));
  await client.connect("test-agent");

  // Modify server to send a message after welcome
  const serverStream = streams[0];

  const messageReceived = new Promise<any>((resolve) => {
    client.on("send_message", resolve);
  });

  serverStream.write({
    send_message: {
      request_id: "req-1",
      thread_id: "thread-abc",
      sender: "user@test",
      content: "Hello from coven",
      attachments: [],
    },
  });

  const msg = await messageReceived;
  expect(msg.request_id).toBe("req-1");
  expect(msg.content).toBe("Hello from coven");
  expect(msg.thread_id).toBe("thread-abc");

  await client.disconnect();
});

it("handles CancelRequest", async () => {
  const client = new CovenGrpcClient(makeAccount(port));
  await client.connect("test-agent");

  const serverStream = streams[0];

  const cancelReceived = new Promise<any>((resolve) => {
    client.on("cancel_request", resolve);
  });

  serverStream.write({
    cancel_request: {
      request_id: "req-cancel",
      reason: "user_requested",
    },
  });

  const cancel = await cancelReceived;
  expect(cancel.request_id).toBe("req-cancel");
  expect(cancel.reason).toBe("user_requested");

  await client.disconnect();
});

it("handles InjectContext", async () => {
  const client = new CovenGrpcClient(makeAccount(port));
  await client.connect("test-agent");

  const serverStream = streams[0];

  const injectionReceived = new Promise<any>((resolve) => {
    client.on("inject_context", resolve);
  });

  serverStream.write({
    inject_context: {
      injection_id: "inj-1",
      content: "System context update",
      priority: "INJECTION_PRIORITY_NORMAL",
    },
  });

  const injection = await injectionReceived;
  expect(injection.injection_id).toBe("inj-1");
  expect(injection.content).toBe("System context update");

  await client.disconnect();
});
```

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS (unit + integration).

**Step 3: Commit**

```bash
git add test/integration/lifecycle.test.ts
git commit -m "test: add message round-trip, cancellation, and injection integration tests"
```

---

## Task 10: Final Verification and Cleanup

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No type errors (or only type errors from openclaw SDK resolution, which is expected in standalone mode and can be addressed by installing the dev dependency).

**Step 3: Verify file structure matches design**

Run: `find . -name "*.ts" | sort`
Expected output should match the design doc's file layout.

**Step 4: Test installation with openclaw**

Run: `cd /path/to/openclaw && openclaw plugins install --link /Users/harper/Public/src/2389/coven-openclaw`
Expected: Plugin installs and appears in `openclaw plugins list`.

**Step 5: Commit any cleanup**

```bash
git add -A
git commit -m "chore: final cleanup and verification"
```

---

## Post-Implementation Notes

**What's ready to use:**
- Full gRPC client with bidirectional streaming
- Protocol translation for all message types
- Account management and configuration
- Health checking and status reporting
- CLI onboarding wizard
- Auto-reconnect with exponential backoff
- MCP bridge stub (needs runtime wiring for full integration)

**What needs further work (not in scope for initial implementation):**
- Full MCP bridge integration (registering/unregistering MCP servers in openclaw runtime at connect/disconnect)
- Multi-agent mode spawning (creating separate gRPC streams per openclaw agent)
- Wiring inbound messages into openclaw's actual message pipeline (requires runtime API calls)
- E2E tests with a running coven-gateway instance
- SSH/JWT authentication credential handling in the gRPC channel
