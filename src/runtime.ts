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
