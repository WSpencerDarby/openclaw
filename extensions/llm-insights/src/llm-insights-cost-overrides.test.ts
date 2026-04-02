import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createLlmInsightsCostOverridesPostHandler } from "./llm-insights-cost-overrides.js";

function createMockReq(overrides: Partial<IncomingMessage>): IncomingMessage {
  return {
    method: "GET",
    url: "/plugins/llm-insights-cost-overrides",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  } as unknown as IncomingMessage;
}

function createMockRes(): {
  res: ServerResponse;
  headers: Record<string, string | number | string[]>;
} {
  const headers: Record<string, string | number | string[]> = {};
  const res = {
    statusCode: 0,
    setHeader(name: string, value: string | number | string[]) {
      headers[name.toLowerCase()] = value;
    },
    end(_chunk?: string) {},
  } as unknown as ServerResponse;
  return { res, headers };
}

describe("llm-insights-cost-overrides", () => {
  it("responds to CORS preflight with 204 and allow headers", async () => {
    const api = {
      runtime: {
        config: {
          loadConfig: vi.fn(() => ({
            gateway: { auth: { mode: "none" } },
          })),
          writeConfigFile: vi.fn(),
        },
      },
    };
    const handler = createLlmInsightsCostOverridesPostHandler(api as never);
    const req = createMockReq({
      method: "OPTIONS",
      headers: {
        origin: "null",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type, authorization",
      },
    });
    const { res, headers } = createMockRes();

    const handled = await handler(req, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(headers["access-control-allow-origin"]).toBe("null");
    expect(headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
    expect(String(headers["access-control-allow-headers"])).toContain("Authorization");
  });
});
