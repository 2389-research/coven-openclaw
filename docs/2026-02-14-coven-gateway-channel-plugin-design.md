# Coven Gateway Channel Plugin Design

> OpenClaw channel plugin that implements coven-gateway's gRPC AgentStream protocol,
> making openclaw agents available as backends for coven's frontends (webadmin, Slack, Matrix, etc.).

## Architecture Overview

The `coven` channel plugin connects openclaw to one or more coven-gateway instances.
Each "account" in the plugin config represents a connection to a coven-gateway server.

```
┌─────────────────────────────────────────────────┐
│  coven-gateway (Go)                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ WebAdmin │  │  Slack   │  │   Matrix     │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       └──────────────┼───────────────┘          │
│              gRPC AgentStream                   │
└──────────────────────┬──────────────────────────┘
                       │ bidirectional stream
                       │ (protobuf)
┌──────────────────────┼──────────────────────────┐
│  openclaw                                        │
│  ┌───────────────────▼────────────────────────┐  │
│  │  coven channel plugin                      │  │
│  │  ┌─────────────┐  ┌────────────────────┐   │  │
│  │  │ gRPC Client │  │ Protocol Translator│   │  │
│  │  │ (per acct)  │  │ coven↔openclaw msg │   │  │
│  │  └──────┬──────┘  └─────────┬──────────┘   │  │
│  └─────────┼───────────────────┼──────────────┘  │
│            │                   │                  │
│  ┌─────────▼───────────────────▼──────────────┐  │
│  │  openclaw agent runtime                    │  │
│  │  (message pipeline → model → response)     │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### Agent Mapping (Configurable)

- **Multi-agent mode**: Each openclaw agent registers separately with coven-gateway.
  Coven sees `openclaw-code`, `openclaw-research`, etc. Each agent gets its own gRPC stream.
- **Single-agent mode**: One registration with coven-gateway. The plugin routes internally
  based on thread or sender context.

### Connection Lifecycle

1. `gateway.startAccount()` → create gRPC client → open `AgentStream`
2. Send `RegisterAgent` with agent metadata, capabilities, tools
3. Enter receive loop: handle `SendMessage`, `InjectContext`, `CancelRequest`, etc.
4. Heartbeat on 30s interval
5. Auto-reconnect with exponential backoff on disconnect
6. `gateway.stopAccount()` → graceful shutdown

## Message Flow & Protocol Translation

### Inbound (coven → openclaw)

```
coven SendMessage {request_id, thread_id, sender, content, attachments}
  ↓
Plugin maps to openclaw session key: "coven:{accountId}:{thread_id}"
  ↓
Attachments converted: FileAttachment bytes → openclaw media format
  ↓
Dispatched into openclaw's message pipeline as a normalized inbound message
  ↓
Agent runtime picks it up, runs the model
```

### Outbound (openclaw → coven)

As the agent streams its response, the plugin translates events to coven
`MessageResponse` frames and sends them over the gRPC stream:

| openclaw event        | coven MessageResponse event |
|-----------------------|-----------------------------|
| Thinking output       | `thinking`                  |
| Text chunk            | `text`                      |
| Final response        | `done`                      |
| Error                 | `error`                     |
| File/media            | `file`                      |
| Token stats           | `usage`                     |

OpenClaw agents produce text/thinking/file responses only — no tool_use/tool_result
events are exposed to coven.

### Context Injection

When coven sends `InjectContext` (from a pack tool or admin action):

1. Plugin receives it on the gRPC stream
2. Translates to an openclaw system message injected into the current session
3. Sends back `InjectionAck` with accepted/rejected status

### Request Cancellation

When coven sends `CancelRequest`:

1. Plugin matches `request_id` to the in-flight openclaw agent run
2. Aborts the run via openclaw's cancellation mechanism
3. Sends `MessageResponse.cancelled` back to coven

## Configuration

Lives under `channels.coven` in openclaw's config:

```json5
{
  "channels": {
    "coven": {
      "accounts": {
        "default": {
          "endpoint": "localhost:50051",
          "mode": "multi",                 // "multi" | "single"
          "agentFilter": [],               // empty = all agents, or ["code", "research"]
          "tls": false,                    // true if coven is behind tailscale/TLS
          "authMethod": "ssh",             // "ssh" | "jwt"
          "sshKeyPath": "~/.ssh/id_ed25519",
          "jwtSecret": "${COVEN_JWT_SECRET}",
          "heartbeatIntervalMs": 30000,
          "reconnect": {
            "maxAttempts": 10,
            "baseDelayMs": 1000,
            "maxDelayMs": 60000
          }
        }
      }
    }
  }
}
```

## Agent Registration

Registration payload built at connect time:

```
RegisterAgent {
  agent_id:    "openclaw-{agentName}"
  name:        "{agentName} (OpenClaw)"
  capabilities: ["chat", "streaming", "files"]
  metadata: {
    hostname:          os.hostname()
    os:                process.platform
    working_directory: openclaw's cwd
    backend:           "openclaw"
    git:               { branch, commit, dirty }
    workspaces:        ["openclaw"]
  }
  protocol_features: ["token_usage", "injection", "cancellation"]
}
```

- **Multi mode**: One `RegisterAgent` per openclaw agent (filtered by `agentFilter`).
  Each gets its own gRPC stream.
- **Single mode**: One `RegisterAgent` for the whole openclaw instance.
  Thread-based routing picks the agent internally.

## Tool Integration via MCP

Coven-gateway's `Welcome` message includes `mcp_endpoint` and `mcp_token`.
The plugin registers coven's MCP endpoint as an MCP server in openclaw's runtime.
Openclaw agents access coven's pack tools (notes, todos, mail, admin, etc.)
through openclaw's existing MCP infrastructure.

On disconnect, the MCP server registration is removed. On reconnect, a fresh
token from the new `Welcome` message re-registers it.

## Plugin Adapters

| Adapter       | Status      | Notes                                                       |
|---------------|-------------|-------------------------------------------------------------|
| `id` / `meta` | Implemented | `id: "coven"`, chatTypes: `["direct", "thread"]`          |
| `config`      | Implemented | Account resolution, list accounts, enable/disable           |
| `configSchema`| Implemented | TypeBox schema for endpoint, mode, auth, etc.               |
| `gateway`     | Implemented | `startAccount` opens gRPC stream, `stopAccount` closes it   |
| `outbound`    | Implemented | `sendText` → gRPC `MessageResponse.text`                    |
| `status`      | Implemented | Probe = gRPC health check, snapshot tracks connection state  |
| `heartbeat`   | Implemented | Wraps the 30s gRPC `Heartbeat` message                      |
| `messaging`   | Implemented | `normalizeTarget` handles `coven:{accountId}:{threadId}`     |
| `onboarding`  | Implemented | CLI wizard: endpoint, auth method, test connection           |
| `streaming`   | Implemented | Maps openclaw streaming to coven gRPC streaming              |
| `security`    | Skipped     | Auth handled by coven-gateway (SSH/JWT)                      |
| `mentions`    | Skipped     | No mention syntax in coven                                   |
| `groups`      | Skipped     | Coven handles its own frontend grouping                      |
| `directory`   | Skipped     | Agent discovery happens on coven's side                      |
| `actions`     | Skipped     | No reactions/edits/polls through coven                       |

## File Layout

```
extensions/coven/
├── proto/
│   └── coven.proto              # vendored from coven-gateway
├── src/
│   ├── channel.ts               # ChannelPlugin definition (adapters wired together)
│   ├── grpc-client.ts           # gRPC stream management, connect/reconnect/heartbeat
│   ├── protocol.ts              # translate between coven protobuf ↔ openclaw messages
│   ├── registration.ts          # build RegisterAgent from openclaw agent state
│   ├── config.ts                # account resolution, config adapter
│   ├── config-schema.ts         # TypeBox schema for coven channel config
│   ├── status.ts                # probe, snapshot, health checking
│   ├── onboarding.ts            # CLI setup wizard
│   ├── mcp-bridge.ts            # register coven's MCP endpoint as openclaw MCP server
│   └── normalize.ts             # session key normalization
├── package.json
└── tsconfig.json
```

### Key Module Responsibilities

- **grpc-client.ts** — Owns the `AgentStream` bidirectional connection. Exposes
  `connect()`, `disconnect()`, `send(AgentMessage)`, and an event emitter for
  incoming `ServerMessage`. Handles reconnection with exponential backoff.

- **protocol.ts** — Pure translation functions.
  `covenSendMessageToOpenClaw(msg)` and `openClawResponseToCovenMessage(event, requestId)`.
  No side effects, easy to unit test.

- **mcp-bridge.ts** — On `Welcome`, takes `mcp_endpoint` + `mcp_token` and dynamically
  registers it as an MCP server in openclaw's runtime. On disconnect, unregisters.

- **channel.ts** — Thin glue that wires adapters together into the `ChannelPlugin` object.
  Follows the same pattern as `extensions/discord/src/channel.ts`.

## Dependencies

- `@grpc/grpc-js` — Pure JS gRPC client (no native compilation)
- `@grpc/proto-loader` — Dynamic protobuf loading at runtime (no codegen step)

## Error Handling

### Connection Errors

| Scenario                      | Behavior                                                                 |
|-------------------------------|--------------------------------------------------------------------------|
| gRPC endpoint unreachable     | Retry with exponential backoff (1s → 60s). After `maxAttempts` → failed. |
| TLS handshake failure         | Log error, don't retry (config problem). Status → `auth_error`.          |
| `RegistrationError` (dup)     | Append instance suffix, retry once.                                      |
| `RegistrationError` (unauth)  | Status → `auth_error`, stop retrying.                                    |
| Stream drops mid-conversation | Buffer in-flight `request_id`. Reconnect, re-register, resume or flush.  |

### Message Processing Errors

| Scenario                        | Behavior                                                        |
|---------------------------------|-----------------------------------------------------------------|
| Agent throws during processing  | Send `MessageResponse.error` with sanitized message to coven.   |
| Malformed `SendMessage`         | Send `MessageResponse.error`, don't crash the stream.           |
| Timeout                         | Respect coven's request context deadline if provided, else own.  |

### MCP Bridge Errors

| Scenario                               | Behavior                                              |
|----------------------------------------|-------------------------------------------------------|
| Coven MCP endpoint unreachable         | Log warning, skip registration. Retry on reconnect.   |
| MCP token expired mid-session          | Unregister stale server. Fresh token on reconnect.     |

## Proto Vendoring & Versioning

- Vendor `coven.proto` into `extensions/coven/proto/` with source commit hash comment
- `@grpc/proto-loader` loads it dynamically at runtime (no codegen)
- Plugin declares `protocol_features` in `RegisterAgent` for feature negotiation
- Unknown `ServerMessage` types logged as warnings and skipped (proto3 forward compat)
- `PROTO_VERSION` constant tracks vendored version
- Updating: copy new proto from coven-gateway repo, update constant, run tests

## Onboarding Wizard

`openclaw channel add coven` walks through:

1. **Endpoint** — gRPC address (default `localhost:50051`)
2. **Auth method** — SSH key / JWT / none (dev mode)
3. **Key selection** — if SSH, path to private key
4. **Agent mode** — multi (per-agent streams) or single (internal routing)
5. **Connection test** — connect, register, verify Welcome, check MCP availability

## Testing Strategy

### Unit Tests

- **protocol.ts** — Round-trip translation for all event types
- **registration.ts** — Payload correctness for single/multi mode, agentFilter
- **normalize.ts** — Session key parsing and formatting
- **config.ts** — Account resolution, defaults, enable/disable

### Integration Tests (mock gRPC server)

- Connection lifecycle: connect → Welcome → heartbeat → disconnect → reconnect
- Message round-trip: SendMessage → agent processes → MessageResponse stream
- Cancellation: CancelRequest mid-response → abort → cancelled response
- Context injection: InjectContext → InjectionAck
- MCP bridge: Welcome with mcp_endpoint → MCP registered; disconnect → unregistered
- Multi-agent mode: 3 agents → 3 streams with distinct agent_id values

### E2E Tests (running coven-gateway)

- Full path: coven HTTP → gRPC → openclaw agent → gRPC → coven SSE
- Requires standing up coven-gateway binary + openclaw with coven plugin configured

## What This Does NOT Do

- Expose openclaw tools to coven's tool registry
- Handle coven frontend concerns (Slack formatting, Matrix rooms, etc.)
- Replace or duplicate coven's auth system
- Codegen from protobuf
