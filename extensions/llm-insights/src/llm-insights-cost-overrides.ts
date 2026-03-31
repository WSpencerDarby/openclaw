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

type CostOverridesBody = {
  overrides?: Record<
    string,
    { input: number; output: number; cacheRead: number; cacheWrite: number }
  >;
  removeKeys?: string[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCostEntry(
  value: unknown,
): value is { input: number; output: number; cacheRead: number; cacheWrite: number } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    isFiniteNumber(v.input) &&
    isFiniteNumber(v.output) &&
    isFiniteNumber(v.cacheRead) &&
    isFiniteNumber(v.cacheWrite)
  );
}

function parseCostOverridesBody(raw: string): CostOverridesBody | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
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
        overrides[k] = {
          input: v.input,
          output: v.output,
          cacheRead: v.cacheRead,
          cacheWrite: v.cacheWrite,
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
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Allow", "POST");
      res.end("Method Not Allowed");
      return true;
    }

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
