import type { IncomingMessage, ServerResponse } from "node:http";
import {
  authorizeHttpGatewayConnect,
  getBearerToken,
  isLocalDirectRequest,
  resolveGatewayAuth,
  sendGatewayAuthFailure,
} from "openclaw/plugin-sdk/gateway-runtime";
import type { OpenClawPluginApi } from "../api.js";

const MAX_BODY_BYTES = 256_000;

/**
 * Browser plugin pages opened from the Control UI load as `blob:` URLs, so POSTs to the
 * gateway are cross-origin and send a CORS preflight (OPTIONS). Without these headers the
 * save request never runs. Echo `Origin` (including the string `null` for opaque/blob origins).
 */
function setCostOverridesCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

type CostOverridesBody = {
  overrides?: Record<
    string,
    { input: number; output: number; cacheRead: number; cacheWrite: number }
  >;
  removeKeys?: string[];
};

function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return undefined;
}

function isCostEntry(
  value: unknown,
): value is { input: number; output: number; cacheRead: number; cacheWrite: number } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    coerceFiniteNumber(v.input) !== undefined &&
    coerceFiniteNumber(v.output) !== undefined &&
    coerceFiniteNumber(v.cacheRead) !== undefined &&
    coerceFiniteNumber(v.cacheWrite) !== undefined
  );
}

function parseCostOverridesBody(raw: string): CostOverridesBody | null {
  try {
    const trimmed = raw.trim();
    if (trimmed === "") {
      return {};
    }
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const out: CostOverridesBody = {};
    if (obj.overrides !== undefined) {
      if (typeof obj.overrides !== "object" || obj.overrides === null) {
        return null;
      }
      const overrides: CostOverridesBody["overrides"] = {};
      for (const [k, v] of Object.entries(obj.overrides)) {
        if (!k.trim() || !isCostEntry(v)) {
          return null;
        }
        const rec = v as Record<string, unknown>;
        overrides[k] = {
          input: coerceFiniteNumber(rec.input)!,
          output: coerceFiniteNumber(rec.output)!,
          cacheRead: coerceFiniteNumber(rec.cacheRead)!,
          cacheWrite: coerceFiniteNumber(rec.cacheWrite)!,
        };
      }
      out.overrides = overrides;
    }
    if (obj.removeKeys !== undefined) {
      if (!Array.isArray(obj.removeKeys)) {
        return null;
      }
      const keys = obj.removeKeys.filter((k): k is string => typeof k === "string" && k.trim() !== "");
      if (keys.length !== obj.removeKeys.length) {
        return null;
      }
      out.removeKeys = keys;
    }
    return out;
  } catch {
    return null;
  }
}

async function assertCostOverrideWriteAllowed(
  api: OpenClawPluginApi,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const cfg = api.runtime.config.loadConfig();
  const auth = resolveGatewayAuth({
    authConfig: cfg.gateway?.auth,
    env: process.env,
  });
  const trustedProxies = cfg.gateway?.trustedProxies ?? [];
  const allowRealIpFallback = cfg.gateway?.allowRealIpFallback === true;
  const token = getBearerToken(req);

  if (auth.mode === "none") {
    return true;
  }

  // Token/password mode on a direct loopback request: allow without Authorization so
  // the same browser session that loaded the plugin page can save (relative fetch
  // cannot inject OPENCLAW_GATEWAY_TOKEN like Node-side clients).
  if (
    (auth.mode === "token" || auth.mode === "password") &&
    isLocalDirectRequest(req, trustedProxies, allowRealIpFallback)
  ) {
    return true;
  }

  const result = await authorizeHttpGatewayConnect({
    auth,
    connectAuth: token ? { token, password: token } : null,
    req,
    trustedProxies,
    allowRealIpFallback,
  });
  if (!result.ok) {
    sendGatewayAuthFailure(res, result);
    return false;
  }
  return true;
}

async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error("body too large");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createLlmInsightsCostOverridesPostHandler(api: OpenClawPluginApi) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const method = (req.method ?? "GET").toUpperCase();

    if (method === "OPTIONS") {
      setCostOverridesCorsHeaders(req, res);
      res.statusCode = 204;
      res.end();
      return true;
    }

    if (method !== "POST") {
      setCostOverridesCorsHeaders(req, res);
      res.statusCode = 405;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Allow", "POST, OPTIONS");
      res.end("Method Not Allowed");
      return true;
    }

    setCostOverridesCorsHeaders(req, res);

    if (!(await assertCostOverrideWriteAllowed(api, req, res))) {
      return true;
    }

    let raw: string;
    try {
      raw = await readRequestBody(req, MAX_BODY_BYTES);
    } catch {
      res.statusCode = 413;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Payload Too Large");
      return true;
    }

    const body = parseCostOverridesBody(raw);
    if (!body) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "invalid JSON body" }));
      return true;
    }

    const current = api.runtime.config.loadConfig();
    const prev = current.models?.usageCostOverrides ?? {};
    const nextOverrides: Record<
      string,
      { input: number; output: number; cacheRead: number; cacheWrite: number }
    > = { ...prev };

    for (const k of body.removeKeys ?? []) {
      delete nextOverrides[k];
    }
    for (const [k, v] of Object.entries(body.overrides ?? {})) {
      nextOverrides[k] = v;
    }

    const nextModels = { ...(current.models ?? {}) };
    if (Object.keys(nextOverrides).length === 0) {
      delete nextModels.usageCostOverrides;
    } else {
      nextModels.usageCostOverrides = nextOverrides;
    }

    const nextConfig = {
      ...current,
      models: nextModels,
    };

    try {
      await api.runtime.config.writeConfigFile(nextConfig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: msg }));
      return true;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ ok: true }));
    return true;
  };
}
