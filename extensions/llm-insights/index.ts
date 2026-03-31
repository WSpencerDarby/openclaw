import { definePluginEntry, type AnyAgentTool, type OpenClawPluginApi } from "./api.js";
import { createLlmInsightsCostOverridesPostHandler } from "./src/llm-insights-cost-overrides.js";
import { createLlmInsightsHttpHandler } from "./src/llm-insights-http.js";
import { createLlmInsightsOverviewTool } from "./src/llm-insights-tool.js";

export default definePluginEntry({
  id: "llm-insights",
  name: "LLM Insights",
  description: "Model catalog, usage, cost, and latency summaries",
  register(api: OpenClawPluginApi) {
    const pluginCfg = (api.pluginConfig ?? {}) as {
      defaultDays?: number;
      defaultLimit?: number;
    };

    api.registerTool(createLlmInsightsOverviewTool(api) as unknown as AnyAgentTool, {
      optional: true,
    });

    // Path must not be under `/plugins/llm-insights/...` or it overlaps the prefix route
    // and registration fails when auth differs (see `doPluginHttpRoutesOverlap`).
    api.registerHttpRoute({
      path: "/plugins/llm-insights-cost-overrides",
      // Plugin auth: handler enforces gateway Bearer for remote; loopback can save without
      // pasting the token (same machine as the gateway, same exposure as GET).
      auth: "plugin",
      match: "exact",
      handler: createLlmInsightsCostOverridesPostHandler(api),
    });

    api.registerHttpRoute({
      path: "/plugins/llm-insights",
      // Plugin auth: do not require gateway Bearer for GET (browser tab / open link).
      // Same host exposure as the Control UI; bind loopback or use gateway auth for remote access.
      auth: "plugin",
      match: "prefix",
      handler: createLlmInsightsHttpHandler({
        api,
        defaultDays: pluginCfg.defaultDays,
        defaultLimit: pluginCfg.defaultLimit,
      }),
    });
  },
});
