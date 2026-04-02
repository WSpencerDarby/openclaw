/**
 * Open gateway-hosted plugin HTML pages (e.g. /plugins/llm-insights) in a new tab.
 *
 * Always opens as a real HTTP URL (never a blob: URL). Blob URLs inherit the opener
 * document's Content-Security-Policy, which blocks the plugin page's own inline scripts
 * (the hashes differ). Real HTTP navigations get the plugin page's own CSP header.
 *
 * When gateway auth is token/password, the secret is appended as `?_oc_token=…` so
 * the plugin page can pre-fill it into the bearer field. The token is only passed over
 * loopback (same machine), matching the existing loopback-bypass in the POST handler.
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
  const baseUrl = resolveGatewayPluginHttpUrl({
    wsUrl: params.wsUrl,
    path: params.path,
    pageBase: params.pageBase,
  });

  // Always navigate to the real HTTP URL. Blob URLs inherit the opener's CSP, which
  // blocks the plugin page's inline script (hash mismatch). A direct HTTP navigation
  // gets the plugin page's own Content-Security-Policy response header.
  let url = baseUrl;
  if (authMode === "token" || authMode === "password") {
    const secret = params.bearerSecret.trim();
    if (secret) {
      // Append token so the page can pre-fill the bearer field. Only meaningful on
      // loopback where the POST handler already bypasses auth for direct requests.
      const u = new URL(baseUrl);
      u.searchParams.set("_oc_token", secret);
      url = u.toString();
    }
  }

  const opened = openExternalUrlSafe(url);
  if (!opened) {
    window.location.assign(url);
  }
}
