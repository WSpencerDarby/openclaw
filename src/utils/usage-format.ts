import fs from "node:fs";
import path from "node:path";
import { resolveOpenClawAgentDir } from "../agents/agent-paths.js";
import { modelKey, normalizeModelRef, normalizeProviderId } from "../agents/model-selection.js";
import type { NormalizedUsage } from "../agents/usage.js";
import type { OpenClawConfig } from "../config/config.js";
import type { ModelProviderConfig } from "../config/types.models.js";
import { getCachedGatewayModelPricing } from "../gateway/model-pricing-cache.js";

export type ModelCostConfig = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type UsageTotals = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
};

type ModelsJsonCostCache = {
  path: string;
  mtimeMs: number;
  entries: Map<string, ModelCostConfig>;
};

let modelsJsonCostCache: ModelsJsonCostCache | null = null;

export function formatTokenCount(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "0";
  }
  const safe = Math.max(0, value);
  if (safe >= 1_000_000) {
    return `${(safe / 1_000_000).toFixed(1)}m`;
  }
  if (safe >= 1_000) {
    const precision = safe >= 10_000 ? 0 : 1;
    const formattedThousands = (safe / 1_000).toFixed(precision);
    if (Number(formattedThousands) >= 1_000) {
      return `${(safe / 1_000_000).toFixed(1)}m`;
    }
    return `${formattedThousands}k`;
  }
  return String(Math.round(safe));
}

export function formatUsd(value?: number): string | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(2)}`;
  }
  return `$${value.toFixed(4)}`;
}

function toResolvedModelKey(params: { provider?: string; model?: string }): string | null {
  const provider = params.provider?.trim();
  const model = params.model?.trim();
  if (!provider || !model) {
    return null;
  }
  const normalized = normalizeModelRef(provider, model);
  return modelKey(normalized.provider, normalized.model);
}

function buildProviderCostIndex(
  providers: Record<string, ModelProviderConfig> | undefined,
): Map<string, ModelCostConfig> {
  const entries = new Map<string, ModelCostConfig>();
  if (!providers) {
    return entries;
  }
  for (const [providerKey, providerConfig] of Object.entries(providers)) {
    const normalizedProvider = normalizeProviderId(providerKey);
    for (const model of providerConfig?.models ?? []) {
      const normalized = normalizeModelRef(normalizedProvider, model.id);
      entries.set(modelKey(normalized.provider, normalized.model), model.cost);
    }
  }
  return entries;
}

function loadModelsJsonCostIndex(): Map<string, ModelCostConfig> {
  const modelsPath = path.join(resolveOpenClawAgentDir(), "models.json");
  try {
    const stat = fs.statSync(modelsPath);
    if (
      modelsJsonCostCache &&
      modelsJsonCostCache.path === modelsPath &&
      modelsJsonCostCache.mtimeMs === stat.mtimeMs
    ) {
      return modelsJsonCostCache.entries;
    }

    const parsed = JSON.parse(fs.readFileSync(modelsPath, "utf8")) as {
      providers?: Record<string, ModelProviderConfig>;
    };
    const entries = buildProviderCostIndex(parsed.providers);
    modelsJsonCostCache = {
      path: modelsPath,
      mtimeMs: stat.mtimeMs,
      entries,
    };
    return entries;
  } catch {
    const empty = new Map<string, ModelCostConfig>();
    modelsJsonCostCache = {
      path: modelsPath,
      mtimeMs: -1,
      entries: empty,
    };
    return empty;
  }
}

function findConfiguredProviderCost(params: {
  provider?: string;
  model?: string;
  config?: OpenClawConfig;
}): ModelCostConfig | undefined {
  const key = toResolvedModelKey(params);
  if (!key) {
    return undefined;
  }
  return buildProviderCostIndex(params.config?.models?.providers).get(key);
}

function isUsageCostOverrideEntry(value: unknown): value is ModelCostConfig {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.input === "number" &&
    Number.isFinite(v.input) &&
    typeof v.output === "number" &&
    Number.isFinite(v.output) &&
    typeof v.cacheRead === "number" &&
    Number.isFinite(v.cacheRead) &&
    typeof v.cacheWrite === "number" &&
    Number.isFinite(v.cacheWrite)
  );
}

export function resolveModelCostConfig(params: {
  provider?: string;
  model?: string;
  config?: OpenClawConfig;
}): ModelCostConfig | undefined {
  const key = toResolvedModelKey(params);
  if (!key) {
    return undefined;
  }

  const manual = params.config?.models?.usageCostOverrides?.[key];
  if (manual && isUsageCostOverrideEntry(manual)) {
    return {
      input: manual.input,
      output: manual.output,
      cacheRead: manual.cacheRead,
      cacheWrite: manual.cacheWrite,
    };
  }

  const modelsJsonCost = loadModelsJsonCostIndex().get(key);
  if (modelsJsonCost) {
    return modelsJsonCost;
  }

  const configuredCost = findConfiguredProviderCost(params);
  if (configuredCost) {
    return configuredCost;
  }

  return getCachedGatewayModelPricing(params);
}

const toNumber = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * When usage only has a rollup token total (common for local/Ollama) and no
 * input/output/cache breakdown, split the total 50/50 so per-million input and
 * output rates from `models.usageCostOverrides` both contribute to estimates.
 */
export function coalesceUsageComponentsForPricing(totals: {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Session aggregates use this field; transcript `usage.total` maps here when needed. */
  totalTokens?: number;
  /** NormalizedUsage-style rollup when components are absent. */
  total?: number;
}): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  const input = toNumber(totals.input);
  const output = toNumber(totals.output);
  const cacheRead = toNumber(totals.cacheRead);
  const cacheWrite = toNumber(totals.cacheWrite);
  const partsSum = input + output + cacheRead + cacheWrite;
  if (partsSum > 0) {
    return { input, output, cacheRead, cacheWrite };
  }
  const rollup = toNumber(totals.totalTokens) || toNumber(totals.total);
  if (rollup <= 0) {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  }
  const half = rollup / 2;
  return { input: half, output: half, cacheRead: 0, cacheWrite: 0 };
}

export function estimateUsageCost(params: {
  usage?: NormalizedUsage | UsageTotals | null;
  cost?: ModelCostConfig;
}): number | undefined {
  const usage = params.usage;
  const cost = params.cost;
  if (!usage || !cost) {
    return undefined;
  }
  const rollup = usage as NormalizedUsage & { totalTokens?: number };
  const coalesced = coalesceUsageComponentsForPricing({
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: rollup.totalTokens,
    total: usage.total,
  });
  const total =
    coalesced.input * cost.input +
    coalesced.output * cost.output +
    coalesced.cacheRead * cost.cacheRead +
    coalesced.cacheWrite * cost.cacheWrite;
  if (!Number.isFinite(total)) {
    return undefined;
  }
  return total / 1_000_000;
}

/**
 * Per-component USD estimates from raw token counts and per-million-token USD rates.
 * Used to refresh session aggregates when pricing (including `models.usageCostOverrides`) changes.
 */
export function estimateCostBreakdownFromUsageAndPricing(params: {
  usage: Pick<UsageTotals, "input" | "output" | "cacheRead" | "cacheWrite" | "total"> & {
    totalTokens?: number;
  };
  cost: ModelCostConfig;
}): {
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
} {
  const { input, output, cacheRead, cacheWrite } = coalesceUsageComponentsForPricing(params.usage);
  const cost = params.cost;
  const inputCost = (input / 1_000_000) * cost.input;
  const outputCost = (output / 1_000_000) * cost.output;
  const cacheReadCost = (cacheRead / 1_000_000) * cost.cacheRead;
  const cacheWriteCost = (cacheWrite / 1_000_000) * cost.cacheWrite;
  const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;
  return {
    totalCost: Number.isFinite(totalCost) ? totalCost : 0,
    inputCost: Number.isFinite(inputCost) ? inputCost : 0,
    outputCost: Number.isFinite(outputCost) ? outputCost : 0,
    cacheReadCost: Number.isFinite(cacheReadCost) ? cacheReadCost : 0,
    cacheWriteCost: Number.isFinite(cacheWriteCost) ? cacheWriteCost : 0,
  };
}

export function __resetUsageFormatCachesForTest(): void {
  modelsJsonCostCache = null;
}
