// ABOUTME: Plugin entry point for the coven-gateway channel plugin.
// ABOUTME: Registers the coven channel with openclaw's plugin system.

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { covenPlugin } from "./src/channel.js";
import { setCovenRuntime } from "./src/runtime.js";

const plugin = {
  id: "coven-openclaw",
  name: "Coven Gateway",
  description: "Connect openclaw agents to coven-gateway via gRPC AgentStream",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setCovenRuntime(api.runtime);
    api.registerChannel({ plugin: covenPlugin });
  },
};

export default plugin;
