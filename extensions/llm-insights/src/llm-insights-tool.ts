import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../api.js";
import { buildLlmInsightsPayload, type InsightParams } from "./llm-insights-core.js";

export function createLlmInsightsOverviewTool(api: OpenClawPluginApi) {
  const pluginCfg = (api.pluginConfig ?? {}) as {
    defaultDays?: number;
    defaultLimit?: number;
  };

  return {
    name: "llm_insights_overview",
    description:
      "Returns available LLM models for this gateway, estimated token/cost usage over a time window, provider quota snapshots (where supported), and session aggregates including assistant-turn latency stats derived from transcripts (not model benchmark scores). For an HTML summary in the browser, open GET /plugins/llm-insights on the gateway host.",
    parameters: Type.Object({
      days: Type.Optional(Type.Number({ minimum: 1, maximum: 365 })),
      startDate: Type.Optional(Type.String()),
      endDate: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
      key: Type.Optional(
        Type.String({
          description:
            "Optional session store key to scope session aggregates; omit to include discovered sessions in range.",
        }),
      ),
    }),
    async execute(
      _id: string,
      params: InsightParams,
    ): Promise<{ content: Array<{ type: "text"; text: string }> }> {
      const result = await buildLlmInsightsPayload(api, params, {
        defaultDays: pluginCfg.defaultDays,
        defaultLimit: pluginCfg.defaultLimit,
      });

      if (!result.ok) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: result.error }, null, 2) }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
      };
    },
  };
}
