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
