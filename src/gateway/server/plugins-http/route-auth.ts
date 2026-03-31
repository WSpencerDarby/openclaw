import type { PluginRegistry } from "../../../plugins/registry.js";
import {
  isProtectedPluginRoutePathFromContext,
  resolvePluginRoutePathContext,
  type PluginRoutePathContext,
} from "./path-context.js";
import { findMatchingPluginHttpRoutes } from "./route-match.js";

/**
 * Whether the route that runs **first** for plugin HTTP dispatch requires gateway Bearer auth.
 * Match order follows {@link findMatchingPluginHttpRoutes} (exact/longest-prefix first).
 * Using the primary route only avoids unrelated shorter-prefix routes (possibly `auth: "gateway"`)
 * forcing auth on longer `auth: "plugin"` paths under the same URL hierarchy.
 */
export function matchedPluginRoutesRequireGatewayAuth(
  routes: readonly Pick<NonNullable<PluginRegistry["httpRoutes"]>[number], "auth">[],
): boolean {
  return routes[0]?.auth === "gateway";
}

export function shouldEnforceGatewayAuthForPluginPath(
  registry: PluginRegistry,
  pathnameOrContext: string | PluginRoutePathContext,
): boolean {
  const pathContext =
    typeof pathnameOrContext === "string"
      ? resolvePluginRoutePathContext(pathnameOrContext)
      : pathnameOrContext;
  if (pathContext.malformedEncoding || pathContext.decodePassLimitReached) {
    return true;
  }
  if (isProtectedPluginRoutePathFromContext(pathContext)) {
    return true;
  }
  return matchedPluginRoutesRequireGatewayAuth(findMatchingPluginHttpRoutes(registry, pathContext));
}
