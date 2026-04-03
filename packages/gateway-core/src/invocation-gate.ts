/**
 * STATE gating for API invocations.
 *
 * Before each API call, the gateway checks the current state and decides
 * whether to invoke, queue, or log-only. This check must not be bypassed.
 *
 * @see docs/governance/agent-invocation-spec.md §3
 */

import type { GatewayState } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InvocationDecision =
  | { action: "invoke" }
  | { action: "queue"; reason: string; notifyEntity: boolean; message: string }
  | { action: "log_only" };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine whether an API invocation should proceed given the current
 * gateway state.
 */
export function gateInvocation(state: GatewayState): InvocationDecision {
  switch (state) {
    case "ONLINE":
      return { action: "invoke" };

    case "LIMBO":
      return {
        action: "queue",
        reason: "gateway_limbo",
        notifyEntity: true,
        message:
          "Your request is being processed. There may be a brief delay.",
      };

    case "OFFLINE":
      return {
        action: "queue",
        reason: "gateway_offline",
        notifyEntity: true,
        message:
          "Aionima is currently offline. Your message has been received and will be processed when connectivity is restored.",
      };

    case "UNKNOWN":
      return { action: "log_only" };
  }
}

/**
 * Check if a message content is a /human command.
 *
 * /human commands bypass the API and route directly to operator queue,
 * processed in ALL gateway states.
 */
export function isHumanCommand(content: unknown): boolean {
  if (typeof content !== "string") return false;
  return content.trim().toLowerCase().startsWith("/human");
}
