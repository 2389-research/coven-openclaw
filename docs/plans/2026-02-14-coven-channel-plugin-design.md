# Coven Gateway Channel Plugin — Validated Design

> Standalone openclaw channel plugin implementing coven-gateway's gRPC AgentStream protocol.
> Installable via `openclaw plugins install`.

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Location | Standalone repo (`coven-openclaw/`) | Independent of openclaw monorepo, publishable as npm package |
| SDK types | `openclaw` as dev dependency, resolved via Jiti loader aliases | Matches how all external plugins reference the SDK |
| Proto loading | `@grpc/proto-loader` dynamic loading (no codegen) | Simpler build, no protoc toolchain required |
| Agent mode | Configurable per-account: multi or single | Matches design doc spec |
| Installation | `openclaw plugins install --link .` (dev) / `openclaw plugins install @2389/openclaw-coven` (prod) | Standard openclaw plugin installation |

## Package Structure

```
coven-openclaw/
├── package.json              # name: "@2389/openclaw-coven", openclaw.extensions: ["./index.ts"]
├── openclaw.plugin.json      # id: "coven", channels: ["coven"]
├── tsconfig.json
├── proto/
│   └── coven.proto           # vendored from coven-gateway (with source commit hash)
├── index.ts                  # register(api) entry point
├── src/
│   ├── runtime.ts            # getter/setter for PluginRuntime
│   ├── channel.ts            # ChannelPlugin definition wiring all adapters
│   ├── grpc-client.ts        # gRPC stream management, connect/reconnect/heartbeat
│   ├── protocol.ts           # translate coven protobuf <-> openclaw messages
│   ├── registration.ts       # build RegisterAgent payload from openclaw agent state
│   ├── config.ts             # account resolution, config adapter
│   ├── config-schema.ts      # JSON schema for coven channel config
│   ├── status.ts             # probe, snapshot, health checking
│   ├── onboarding.ts         # CLI setup wizard
│   ├── mcp-bridge.ts         # dynamic MCP server registration from Welcome message
│   └── normalize.ts          # session key normalization ("coven:{accountId}:{threadId}")
└── test/
    ├── protocol.test.ts      # round-trip translation for all event types
    ├── registration.test.ts  # payload correctness for single/multi mode
    ├── normalize.test.ts     # session key parsing and formatting
    ├── config.test.ts        # account resolution, defaults
    └── integration/
        └── lifecycle.test.ts # connect -> Welcome -> heartbeat -> disconnect -> reconnect
```

## Plugin Conventions

Follows openclaw external plugin conventions exactly:

- `package.json` has `openclaw.extensions` array pointing to entry
- `openclaw.plugin.json` manifest with `id`, `channels`, `configSchema`
- Entry exports object with `register(api: OpenClawPluginApi)` method
- Runtime getter/setter pattern for accessing `PluginRuntime`
- Channel plugin wired via `api.registerChannel({ plugin })`

## Adapters

| Adapter | Status | Notes |
|---------|--------|-------|
| id / meta | Implement | `id: "coven"`, chatTypes: `["direct", "thread"]` |
| config | Implement | Account resolution, list accounts, enable/disable |
| configSchema | Implement | JSON schema for endpoint, mode, auth, etc. |
| gateway | Implement | `startAccount` opens gRPC stream, `stopAccount` closes it |
| outbound | Implement | `sendText` -> gRPC `MessageResponse.text` |
| status | Implement | Probe = gRPC health check, snapshot tracks connection state |
| heartbeat | Implement | Wraps the 30s gRPC Heartbeat message |
| messaging | Implement | `normalizeTarget` handles `coven:{accountId}:{threadId}` |
| onboarding | Implement | CLI wizard: endpoint, auth method, test connection |
| streaming | Implement | Maps openclaw streaming to coven gRPC streaming |
| security | Skip | Auth handled by coven-gateway (SSH/JWT) |
| mentions | Skip | No mention syntax in coven |
| groups | Skip | Coven handles its own frontend grouping |
| directory | Skip | Agent discovery happens on coven's side |
| actions | Skip | No reactions/edits/polls through coven |

## Dependencies

- `@grpc/grpc-js` — Pure JS gRPC client (no native compilation)
- `@grpc/proto-loader` — Dynamic protobuf loading at runtime
- `openclaw` (dev) — Plugin SDK types

## Configuration

Lives under `channels.coven` in openclaw's config. See design doc for full schema.

## Error Handling

See design doc for complete error handling matrix (connection, message processing, MCP bridge).

## Testing Strategy

- **Unit**: protocol.ts, registration.ts, normalize.ts, config.ts
- **Integration**: Mock gRPC server testing full lifecycle
- **E2E**: Full path with running coven-gateway (separate)
