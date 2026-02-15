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
  private _disconnecting = false;

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

  async connect(
    agentName: string,
    registrationOverrides?: Partial<RegistrationParams>
  ): Promise<CovenWelcome> {
    this._agentName = agentName;

    const proto = getProto() as any;
    const credentials = this.account.tls
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure();

    this.grpcClient = new proto.coven.CovenControl(
      this.account.endpoint,
      credentials
    );

    const metadata = new grpc.Metadata();
    if (this.account.jwtToken) {
      metadata.set("authorization", `Bearer ${this.account.jwtToken}`);
    }

    this.stream = this.grpcClient.AgentStream(metadata);

    this._disconnecting = false;

    return new Promise<CovenWelcome>((resolve, reject) => {
      const registration = buildRegistration({
        account: this.account,
        agentName,
        ...registrationOverrides,
      });

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Registration timed out waiting for Welcome"));
      }, 10000);

      const cleanup = () => {
        clearTimeout(timeoutId);
        if (this.stream) {
          this.stream.removeListener("data", onData);
          this.stream.removeListener("error", onError);
        }
      };

      const onData = (msg: any) => {
        if (msg.welcome) {
          cleanup();
          this._connected = true;
          this.startHeartbeat();
          this.attachStreamHandlers();
          resolve(msg.welcome);
        } else if (msg.registration_error) {
          cleanup();
          reject(
            new Error(
              `Registration rejected: ${msg.registration_error.reason}`
            )
          );
        }
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      this.stream.on("data", onData);
      this.stream.on("error", onError);

      this.stream.write({ register: registration });
    });
  }

  async disconnect(): Promise<void> {
    this._disconnecting = true;
    this.stopHeartbeat();
    this._connected = false;

    const stream = this.stream;
    const client = this.grpcClient;

    this.stream = null;
    this.grpcClient = null;

    if (stream) {
      // Replace all listeners with a no-op error sink to absorb any
      // CANCELLED errors that fire asynchronously after close/end.
      stream.removeAllListeners("data");
      stream.removeAllListeners("end");
      stream.removeAllListeners("error");
      stream.on("error", () => {});
      stream.end();
    }

    if (client) {
      client.close();
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
      if (this._disconnecting) return;
      this._connected = false;
      this.stopHeartbeat();
      this.emit("error", err);
    });

    this.stream.on("end", () => {
      if (this._disconnecting) return;
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
          throw new Error(
            "Cannot reconnect: no agent name from initial connect"
          );
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
