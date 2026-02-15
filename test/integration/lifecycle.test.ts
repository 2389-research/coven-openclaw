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

    // Wait for at least one heartbeat (interval is 500ms)
    await new Promise((r) => setTimeout(r, 700));

    expect(client.heartbeatsSent).toBeGreaterThan(0);

    await client.disconnect();
  });

  it("handles graceful disconnect", async () => {
    const client = new CovenGrpcClient(makeAccount(port));
    await client.connect("test-agent");
    await client.disconnect();

    expect(client.connected).toBe(false);
  });

  it("handles SendMessage and emits event", async () => {
    const client = new CovenGrpcClient(makeAccount(port));
    await client.connect("test-agent");

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
});
