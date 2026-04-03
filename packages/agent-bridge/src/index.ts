export type {
  AgentMessage,
  AgentResponse,
  HeldMessage,
  InboundPayload,
  BridgeDispatcher,
  BridgeBroadcaster,
} from "./types.js";

export { AgentBridge } from "./bridge.js";
export type { AgentBridgeDeps } from "./bridge.js";

export type {
  BridgeMessageReceived,
  BridgeReplySent,
  BridgeError,
  BridgeOutboundMessage,
  BridgeReplyRequest,
  BridgeInboundMessage,
} from "./protocol.js";

// Phase 2 — Security Hardening
export {
  sanitizeForPromptLiteral,
  sanitizeRecord,
  containsDangerousUnicode,
  sanitizePath,
} from "./sanitize.js";

export { ContextGuard } from "./context-guard.js";
export type {
  ContextBudgetConfig,
  ContextMessage,
  BudgetResult,
  CapResult,
} from "./context-guard.js";
