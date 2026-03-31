import type { IncomingMessage, ServerResponse } from "node:http";
import { buildLlmInsightsPayload, type InsightParams } from "./llm-insights-core.js";
import type { OpenClawPluginApi } from "../api.js";

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseQuery(url: string | undefined): Record<string, string> {
  if (!url) {
    return {};
  }
  try {
    const u = new URL(url, "http://localhost");
    const out: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  } catch {
    return {};
  }
}

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

function fmtCostUsdPerMTok(c?: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}): string {
  if (!c) {
    return "—";
  }
  return `${c.input} / ${c.output} / ${c.cacheRead} / ${c.cacheWrite}`;
}

export function createLlmInsightsHttpHandler(params: {
  api: OpenClawPluginApi;
  defaultDays?: number;
  defaultLimit?: number;
}) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method not allowed");
      return true;
    }

    const q = parseQuery(req.url);
    const insightParams: InsightParams = {
      days: parseOptionalInt(q.days),
      limit: parseOptionalInt(q.limit),
      key: q.key?.trim() || undefined,
      startDate: q.startDate?.trim() || undefined,
      endDate: q.endDate?.trim() || undefined,
    };

    const result = await buildLlmInsightsPayload(params.api, insightParams, {
      defaultDays: params.defaultDays,
      defaultLimit: params.defaultLimit,
    });

    if (!result.ok) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><html><head><meta charset="utf-8"><title>LLM Insights</title></head><body><p>${escapeHtml(result.error)}</p></body></html>`,
      );
      return true;
    }

    const { data } = result;
    const lat = data.sessionsUsage.aggregates.latency;
    const byModel = data.sessionsUsage.aggregates.byModel.slice(0, 25);
    const providers = data.providerUsage.providers ?? [];

    const rows = byModel
      .map((m) => {
        const lat = m.latency;
        const avg = lat ? `${Math.round(lat.avgMs)}` : "—";
        const p95 = lat ? `${Math.round(lat.p95Ms)}` : "—";
        return `<tr><td>${escapeHtml(m.provider ?? "")}</td><td>${escapeHtml(m.model ?? "")}</td><td>${escapeHtml(String(m.count))}</td><td>${escapeHtml(String(m.totals?.totalCost?.toFixed(4) ?? "0"))}</td><td>${escapeHtml(avg)}</td><td>${escapeHtml(p95)}</td></tr>`;
      })
      .join("");

    const provRows = providers
      .map((p) => {
        const win = p.windows?.[0];
        const pct = win ? `${win.usedPercent}%` : "—";
        return `<tr><td>${escapeHtml(p.displayName)}</td><td>${escapeHtml(p.plan ?? "—")}</td><td>${escapeHtml(p.error ?? pct)}</td></tr>`;
      })
      .join("");

    const costPanelRows = data.modelCostRows
      .map((row) => {
        const o = row.override;
        const auto = escapeHtml(fmtCostUsdPerMTok(row.autoCost));
        const vIn = o ? escapeHtml(String(o.input)) : "";
        const vOut = o ? escapeHtml(String(o.output)) : "";
        const vCr = o ? escapeHtml(String(o.cacheRead)) : "";
        const vCw = o ? escapeHtml(String(o.cacheWrite)) : "";
        return `<tr data-cost-key="${escapeHtml(row.key)}" data-had-override="${o ? "1" : "0"}"><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.model)}</td><td class="muted">${auto}</td><td><input type="number" step="any" data-field="input" value="${vIn}" placeholder="in" aria-label="override input"></td><td><input type="number" step="any" data-field="output" value="${vOut}" placeholder="out" aria-label="override output"></td><td><input type="number" step="any" data-field="cacheRead" value="${vCr}" placeholder="cr" aria-label="override cache read"></td><td><input type="number" step="any" data-field="cacheWrite" value="${vCw}" placeholder="cw" aria-label="override cache write"></td></tr>`;
      })
      .join("");

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LLM Insights</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.5rem; color: #111; }
    h1 { font-size: 1.25rem; }
    h2 { font-size: 1rem; margin-top: 1.5rem; }
    table { border-collapse: collapse; width: 100%; max-width: 56rem; font-size: 0.9rem; }
    th, td { border: 1px solid #ccc; padding: 0.35rem 0.5rem; text-align: left; }
    th { background: #f4f4f4; }
    .muted { color: #555; font-size: 0.85rem; }
    .kpis { display: flex; flex-wrap: wrap; gap: 1rem; margin: 1rem 0; }
    .kpi { border: 1px solid #ddd; padding: 0.75rem 1rem; border-radius: 6px; min-width: 8rem; }
    input[type="number"] { width: 6.5rem; }
  </style>
</head>
<body>
  <h1>LLM Insights</h1>
  <p class="muted">Range: <strong>${escapeHtml(data.dateRange.startDate)}</strong> → <strong>${escapeHtml(data.dateRange.endDate)}</strong> · Models: <strong>${data.models.count}</strong> · Sessions in view: <strong>${data.sessionsUsage.sessionCount}</strong></p>
  <p class="muted">For interactive charts and filters, open the Control UI <strong>Usage</strong> tab (<code>/usage</code>) after <code>openclaw dashboard</code>.</p>
  <div class="kpis">
    <div class="kpi">Total cost (est.)<br><strong>$${escapeHtml(data.costSummary.totals.totalCost.toFixed(4))}</strong></div>
    <div class="kpi">Total tokens<br><strong>${escapeHtml(String(data.costSummary.totals.totalTokens))}</strong></div>
    <div class="kpi">Latency avg<br><strong>${lat ? `${Math.round(lat.avgMs)} ms` : "—"}</strong></div>
    <div class="kpi">Latency p95<br><strong>${lat ? `${Math.round(lat.p95Ms)} ms` : "—"}</strong></div>
  </div>
  <h2>Manual usage pricing overrides</h2>
  <p class="muted">USD per <strong>million</strong> tokens: input / output / cache read / cache write. Values are written to <code>models.usageCostOverrides</code> in your OpenClaw config and override catalog, <code>models.json</code>, and gateway pricing cache. Leave a row blank to remove an override. If your gateway uses token or password auth, paste it below (same value as Control UI / WebSocket). If <code>gateway.auth</code> is disabled (common on loopback), leave the field empty.</p>
  <p><label class="muted" for="gw-bearer">Gateway token or password (optional)</label><br><input id="gw-bearer" type="password" autocomplete="off" style="min-width:18rem;max-width:32rem;width:100%;padding:0.35rem" placeholder="Only when gateway auth is enabled"></p>
  <p><button type="button" class="btn" id="llm-cost-save" style="padding:0.4rem 0.75rem">Save overrides to config</button> <span id="llm-cost-status" class="muted"></span></p>
  <table><thead><tr><th>Provider</th><th>Model</th><th>Auto (in/out/cr/cw)</th><th>Override in</th><th>Override out</th><th>Override cr</th><th>Override cw</th></tr></thead><tbody>${costPanelRows || "<tr><td colspan=7>No catalog models</td></tr>"}</tbody></table>
  <h2>Top models by usage</h2>
  <table><thead><tr><th>Provider</th><th>Model</th><th>Turns</th><th>Est. cost</th><th>Latency avg (ms)</th><th>Latency p95 (ms)</th></tr></thead><tbody>${rows || "<tr><td colspan=6>No data</td></tr>"}</tbody></table>
  <h2>Provider quotas (where available)</h2>
  <table><thead><tr><th>Provider</th><th>Plan</th><th>Usage / note</th></tr></thead><tbody>${provRows || "<tr><td colspan=3>No provider usage data</td></tr>"}</tbody></table>
  <h2>Query</h2>
  <p class="muted">Adjust <code>?days=</code>, <code>?limit=</code>, <code>?key=</code> (session key), <code>startDate=</code>/<code>endDate=</code> (YYYY-MM-DD).</p>
  <script>
(function(){
  const btn = document.getElementById("llm-cost-save");
  const status = document.getElementById("llm-cost-status");
  const tokenEl = document.getElementById("gw-bearer");
  function setStatus(msg) { if (status) status.textContent = msg; }
  if (!btn) return;
  btn.addEventListener("click", async function () {
    const token = tokenEl && "value" in tokenEl ? String(tokenEl.value || "").trim() : "";
    const rows = Array.prototype.slice.call(document.querySelectorAll("tr[data-cost-key]"));
    const overrides = {};
    const removeKeys = [];
    for (let i = 0; i < rows.length; i++) {
      const tr = rows[i];
      const key = tr.getAttribute("data-cost-key");
      if (!key) continue;
      const had = tr.getAttribute("data-had-override") === "1";
      function val(field) {
        const el = tr.querySelector('[data-field="' + field + '"]');
        return el && "value" in el ? String(el.value).trim() : "";
      }
      const a = val("input");
      const b = val("output");
      const c = val("cacheRead");
      const d = val("cacheWrite");
      const allEmpty = !a && !b && !c && !d;
      const allFilled = a && b && c && d;
      if (allEmpty && had) {
        removeKeys.push(key);
      } else if (allFilled) {
        const input = parseFloat(a);
        const output = parseFloat(b);
        const cacheRead = parseFloat(c);
        const cacheWrite = parseFloat(d);
        if (![input, output, cacheRead, cacheWrite].every(function (x) { return typeof x === "number" && isFinite(x); })) {
          setStatus("Invalid numbers for " + key);
          return;
        }
        overrides[key] = { input: input, output: output, cacheRead: cacheRead, cacheWrite: cacheWrite };
      } else if (!allEmpty) {
        setStatus("Fill all four override fields for " + key + ", or clear all to remove.");
        return;
      }
    }
    setStatus("Saving…");
    try {
      const headers = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = "Bearer " + token;
      }
      const res = await fetch("/plugins/llm-insights-cost-overrides", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ overrides: overrides, removeKeys: removeKeys })
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("Error " + res.status + ": " + text.slice(0, 200));
        return;
      }
      setStatus("Saved. Refreshing…");
      window.location.reload();
    } catch (e) {
      setStatus(String(e && e.message ? e.message : e));
    }
  });
})();
  <\/script>
</body>
</html>`;

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(html);
    return true;
  };
}
