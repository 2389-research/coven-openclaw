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
