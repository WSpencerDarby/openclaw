/**
 * Open gateway-hosted plugin HTML pages (e.g. /plugins/llm-insights) in a new tab.
 * A plain <a href> cannot send Authorization: Bearer, so we fetch with credentials
 * then open a blob URL (same pattern as tokenized dashboard flows).
 */

import { openExternalUrlSafe } from "./open-external-url.ts";

export type GatewayAuthMode = "none" | "token" | "password" | "trusted-proxy";

export function gatewayWsUrlToHttpOrigin(wsUrl: string, pageBase?: string): string {
  const base =
    pageBase ??
    (typeof globalThis !== "undefined" &&
    "location" in globalThis &&
    typeof (globalThis as { location?: { href?: string } }).location?.href === "string"
      ? (globalThis as { location: { href: string } }).location.href
      : "http://127.0.0.1/");
  const u = new URL(wsUrl.trim(), base);
  if (u.protocol === "ws:") {
    u.protocol = "http:";
  } else if (u.protocol === "wss:") {
    u.protocol = "https:";
  } else if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Unsupported gateway URL protocol: ${u.protocol}`);
  }
  return u.origin;
}

export function resolveGatewayPluginHttpUrl(params: {
  wsUrl: string;
  path: string;
  pageBase?: string;
}): string {
  const origin = gatewayWsUrlToHttpOrigin(params.wsUrl, params.pageBase);
  const p = params.path.startsWith("/") ? params.path : `/${params.path}`;
  return `${origin}${p}`;
}

export async function openGatewayAuthenticatedPage(params: {
  wsUrl: string;
  path: string;
  bearerSecret: string;
  authMode?: GatewayAuthMode;
  pageBase?: string;
}): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("openGatewayAuthenticatedPage requires a browser environment");
  }
  const authMode = params.authMode ?? "none";
  const url = resolveGatewayPluginHttpUrl({
    wsUrl: params.wsUrl,
    path: params.path,
    pageBase: params.pageBase,
  });
  const secret = params.bearerSecret.trim();
  const headers = new Headers();
  if (authMode !== "none") {
    if (!secret) {
      throw new Error("missing gateway credentials");
    }
    headers.set("Authorization", `Bearer ${secret}`);
  }

  const res = await fetch(url, { headers, credentials: "omit", mode: "cors" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const html = await res.text();
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  const child = openExternalUrlSafe(blobUrl);
  if (!child) {
    URL.revokeObjectURL(blobUrl);
    throw new Error("popup blocked");
  }
  window.setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
  }, 60_000);
}
