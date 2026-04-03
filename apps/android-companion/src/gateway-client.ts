/**
 * Gateway WebSocket Client — Android (Task #217)
 *
 * Re-exports the shared gateway client from the iOS companion.
 * The WebSocket client is platform-agnostic (React Native provides WebSocket).
 */

export {
  GatewayClient,
  type PairingRequest,
  type PairingResult,
  type CompanionNotification,
  type GatewayClientHandlers,
} from "@aionima/ios-companion/gateway-client";
