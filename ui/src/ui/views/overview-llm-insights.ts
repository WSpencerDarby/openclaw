import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import {
  openGatewayAuthenticatedPage,
  resolveGatewayPluginHttpUrl,
} from "../gateway-plugin-page.ts";
import { openExternalUrlSafe } from "../open-external-url.ts";
import type { UiSettings } from "../storage.ts";

export type OverviewLlmInsightsProps = {
  connected: boolean;
  settings: UiSettings;
  password: string;
  authMode?: "none" | "token" | "password" | "trusted-proxy";
};

function openLlmInsightsPage(props: OverviewLlmInsightsProps): void {
  const authMode = props.authMode ?? "none";
  const secret = props.settings.token.trim() || props.password.trim();
  if (authMode !== "none" && !secret) {
    const url = resolveGatewayPluginHttpUrl({
      wsUrl: props.settings.gatewayUrl,
      path: "/plugins/llm-insights",
    });
    openExternalUrlSafe(url);
    return;
  }
  void openGatewayAuthenticatedPage({
    wsUrl: props.settings.gatewayUrl,
    path: "/plugins/llm-insights",
    bearerSecret: secret,
    authMode,
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    window.alert(t("overview.llmInsights.openFailed", { message: msg }));
  });
}

/** LLM Insights as a standard overview card (pair with Snapshot). */
export function renderOverviewLlmInsightsCard(
  props: OverviewLlmInsightsProps,
): TemplateResult | typeof nothing {
  if (!props.connected) {
    return nothing;
  }

  return html`
    <div class="card">
      <div class="card-title">${t("overview.llmInsights.accessBlockTitle")}</div>
      <div class="card-sub">${t("overview.llmInsights.accessBlockSub")}</div>
      <div style="margin-top: 14px;">
        <button
          type="button"
          class="btn"
          title=${t("overview.llmInsights.linkTitle")}
          @click=${() => openLlmInsightsPage(props)}
        >
          ${t("overview.llmInsights.openButton")}
        </button>
      </div>
    </div>
  `;
}
