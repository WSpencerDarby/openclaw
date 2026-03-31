---
title: "LLM Insights"
sidebarTitle: "LLM Insights"
summary: "Bundled plugin for model lists, usage, cost, and latency summaries"
read_when:
  - You want agent-callable usage summaries
  - You want a simple HTML view on the gateway
---

# LLM Insights

The bundled `llm-insights` plugin adds:

- **Agent tool** `llm_insights_overview` — JSON payload with models, estimated cost/tokens over a range, provider quota snapshots (where supported), and session aggregates including assistant-turn latency from transcripts.
- **HTML page** — `GET /plugins/llm-insights` on the gateway (same host/port as the Control UI). Registered as a **plugin** HTTP route so a normal browser tab can load it without a gateway Bearer token (same network exposure as serving the Control UI; prefer **loopback** bind or gateway auth for remote gateways). Query parameters: `days`, `limit`, `key` (session key), `startDate`, `endDate` (YYYY-MM-DD).

For **interactive charts**, filters, and session drill-down, run `openclaw dashboard` and open the **Usage** tab. See [Usage tracking](/concepts/usage-tracking).

## Enablement

```json5
{
  plugins: {
    entries: {
      "llm-insights": {
        enabled: true,
        config: {
          defaultDays: 30,
          defaultLimit: 50,
        },
      },
    },
  },
  tools: {
    allow: ["llm_insights_overview"],
  },
}
```

Restart the gateway after changing plugin config.

## Limits

- **Cost** values are **estimates** from local token counts and configured rates where available.
- **Provider quotas** in the summary only include providers with a built-in usage fetcher; not every provider appears.
- **Latency** is derived from **assistant turn timing in transcripts**, not a model benchmark score.
