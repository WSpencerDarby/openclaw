// Public gateway/client helpers for plugins that talk to the host gateway surface.

export * from "../gateway/channel-status-patches.js";
export { GatewayClient } from "../gateway/client.js";
export { createOperatorApprovalsGatewayClient } from "../gateway/operator-approvals-client.js";
export type { EventFrame } from "../gateway/protocol/index.js";

// HTTP gateway auth helpers for plugin routes that enforce writes explicitly.
export {
  authorizeHttpGatewayConnect,
  isLocalDirectRequest,
  resolveGatewayAuth,
} from "../gateway/auth.js";
export type { GatewayAuthResult, ResolvedGatewayAuth } from "../gateway/auth.js";
export { sendGatewayAuthFailure } from "../gateway/http-common.js";
export { getBearerToken } from "../gateway/http-utils.js";
