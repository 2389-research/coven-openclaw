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

/**
 * Build gRPC channel credentials for the probe. When TLS is enabled and a JWT
 * token is present, call credentials carrying the Bearer token are combined
 * with the SSL channel credentials so that the probe channel is fully configured
 * for auth-required gateways. For insecure connections the JWT is omitted here
 * because gRPC does not allow combining call credentials with insecure channels;
 * auth metadata for insecure connections is handled per-stream in grpc-client.ts.
 */
function buildProbeCredentials(
  account: ResolvedCovenAccount
): grpc.ChannelCredentials {
  if (account.tls) {
    const sslCreds = grpc.credentials.createSsl();
    if (account.jwtToken) {
      const callCreds = grpc.credentials.createFromMetadataGenerator(
        (_params, callback) => {
          const metadata = new grpc.Metadata();
          metadata.set("authorization", `Bearer ${account.jwtToken}`);
          callback(null, metadata);
        }
      );
      return grpc.credentials.combineChannelCredentials(sslCreds, callCreds);
    }
    return sslCreds;
  }
  return grpc.credentials.createInsecure();
}

export async function probeCoven(
  account: ResolvedCovenAccount,
  timeoutMs: number
): Promise<CovenProbeResult> {
  const start = Date.now();

  const credentials = buildProbeCredentials(account);

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
