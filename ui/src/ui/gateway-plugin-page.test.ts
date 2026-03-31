import { describe, expect, it } from "vitest";
import {
  gatewayWsUrlToHttpOrigin,
  resolveGatewayPluginHttpUrl,
} from "./gateway-plugin-page.ts";

describe("gateway-plugin-page", () => {
  it("maps ws to http origin", () => {
    expect(gatewayWsUrlToHttpOrigin("ws://127.0.0.1:18789", "http://localhost/")).toBe(
      "http://127.0.0.1:18789",
    );
  });

  it("maps wss to https origin", () => {
    expect(
      gatewayWsUrlToHttpOrigin("wss://gateway.example.com/extra", "https://x/"),
    ).toBe("https://gateway.example.com");
  });

  it("builds plugin URL under gateway origin", () => {
    expect(
      resolveGatewayPluginHttpUrl({
        wsUrl: "ws://127.0.0.1:18789",
        path: "/plugins/llm-insights",
        pageBase: "http://localhost/",
      }),
    ).toBe("http://127.0.0.1:18789/plugins/llm-insights");
  });
});
