/**
 * Tool Registry — Task #115
 *
 * Manages tool registration, state/tier gating, execution, COA logging,
 * size capping, and prompt injection defense for tool results.
 *
 * @see docs/governance/agent-invocation-spec.md §6
 */

import type { VerificationTier } from "@agi/entity-model";
import type { COAChainLogger } from "@agi/coa-chain";

import type { GatewayState } from "./types.js";
import type { ToolManifestEntry, TierCapabilities } from "./system-prompt.js";
import { getTierCapabilities, computeAvailableTools } from "./system-prompt.js";
import { scanToolResult, capToolResult } from "./sanitizer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tool implementation function. */
export type ToolHandler = (input: Record<string, unknown>, ctx?: ToolExecutionContext) => Promise<string> | string;

/** Registered tool with handler. */
export interface RegisteredTool {
  manifest: ToolManifestEntry;
  handler: ToolHandler;
  /** JSON Schema for tool input parameters. */
  inputSchema: Record<string, unknown>;
}

/** Result of executing a tool. */
export interface ToolExecutionResult {
  toolName: string;
  rawResultBytes: number;
  deliveredResultBytes: number;
  wasTruncated: boolean;
  wasInjectionBlocked: boolean;
  coaFingerprint: string;
  content: string;
}

/** Context for tool execution — who's calling, in what state. */
export interface ToolExecutionContext {
  state: GatewayState;
  tier: VerificationTier;
  entityId: string;
  entityAlias: string;
  coaChainBase: string; // base fingerprint for this invocation
  resourceId: string;
  nodeId: string;
  /** AgentSessionManager key — lets background work (e.g. taskmaster_dispatch)
   *  mint injections back into the session that dispatched it. Optional:
   *  headless/background tool calls (like the worker runtime itself) may
   *  leave this unset. */
  sessionKey?: string;
  /** Chat session id that spawned this tool call (if any). Used alongside
   *  sessionKey for UI-side event routing. */
  chatSessionId?: string;
}

/** Worker emission extracted from response text. */
export interface TaskmasterEmission {
  description: string;
  lineNumber: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SIZE_CAP = 16_384; // 16 KB

const WORKER_EMISSION_PATTERN = /^q:>\s+(.+)$/gm;

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  /** Set the COA logger (retained for future use — per-tool COA removed). */
  setCOALogger(_logger: COAChainLogger): void {
    // COA entries are now created at invocation DONE, not per tool call
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a tool.
   *
   * @throws If a tool with the same name is already registered.
   */
  register(
    manifest: ToolManifestEntry,
    handler: ToolHandler,
    inputSchema: Record<string, unknown>,
  ): void {
    // Anthropic + OpenAI both enforce tool names match
    // `^[a-zA-Z0-9_-]{1,128}$`. Validating at registration time means a
    // bad name fails boot — not a customer-facing chat turn. Cycle 68
    // outage (v0.4.275): the s126 ops tools used dot-notation
    // (`pm.list-all-tasks`) which violated this regex; every chat with
    // an ops project active failed with a 400 from Anthropic. The boot
    // path now rejects names that would later cause an API error.
    const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]{1,128}$/;
    if (!VALID_TOOL_NAME.test(manifest.name)) {
      throw new Error(
        `Tool name "${manifest.name}" violates the provider regex /^[a-zA-Z0-9_-]{1,128}$/. ` +
          `Use snake_case or kebab-case; do not use ".", ":", "/", or other punctuation.`,
      );
    }

    if (this.tools.has(manifest.name)) {
      throw new Error(`Tool already registered: ${manifest.name}`);
    }

    this.tools.set(manifest.name, { manifest, handler, inputSchema });
  }

  /** Unregister a tool by name. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Get all registered tool manifests. */
  getManifests(): ToolManifestEntry[] {
    return [...this.tools.values()].map((t) => t.manifest);
  }

  /**
   * Get available tools for the current state and entity tier.
   * Delegates to system-prompt.ts computeAvailableTools. When `projectCategory`
   * is provided, ops-mode tools (those with requiresProjectCategory set) are
   * surfaced to ops/administration projects; others see the regular palette.
   */
  getAvailable(state: GatewayState, tier: VerificationTier, projectCategory?: string): ToolManifestEntry[] {
    return computeAvailableTools(state, tier, this.getManifests(), projectCategory);
  }

  /**
   * Convert available tools to provider-agnostic tool definitions for the API call.
   */
  toProviderTools(
    state: GatewayState,
    tier: VerificationTier,
    projectCategory?: string,
  ): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
    const available = this.getAvailable(state, tier, projectCategory);
    const result: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> = [];

    for (const manifest of available) {
      const registered = this.tools.get(manifest.name);
      if (registered !== undefined) {
        result.push({
          name: manifest.name,
          description: manifest.description,
          input_schema: registered.inputSchema,
        });
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /**
   * Execute a tool by name with input, enforcing all gates.
   *
   * Steps (per spec §6.2):
   * 1. Check tool is in registry (security).
   * 2. Check entity tier (authorization).
   * 3. Execute handler.
   * 4. Enforce size cap.
   * 5. Scan for injection.
   * 6. Write COA record.
   * 7. Return sanitized, capped result.
   */
  async execute(
    toolName: string,
    input: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    // Step 1: Check tool exists
    const registered = this.tools.get(toolName);
    if (registered === undefined) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    // Step 2: Check entity tier
    const tierCaps: TierCapabilities = getTierCapabilities(ctx.tier);
    const isTierExempt = registered.manifest.requiresTier.length === 0;

    if (!tierCaps.canUseTool && !isTierExempt) {
      throw new Error(
        `Entity tier "${ctx.tier}" does not permit tool use`,
      );
    }

    // Also check per-tool tier requirements (skip for tier-exempt tools)
    if (
      !isTierExempt &&
      !registered.manifest.requiresTier.includes(ctx.tier)
    ) {
      throw new Error(
        `Tool "${toolName}" requires tier: ${registered.manifest.requiresTier.join(", ")}`,
      );
    }

    // Check per-tool state requirements
    if (
      registered.manifest.requiresState.length > 0 &&
      !registered.manifest.requiresState.includes(ctx.state)
    ) {
      throw new Error(
        `Tool "${toolName}" requires state: ${registered.manifest.requiresState.join(", ")}`,
      );
    }

    // Step 3: Execute handler
    let rawResult: string;
    try {
      rawResult = await registered.handler(input, ctx);
    } catch (err) {
      rawResult = `Tool execution error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const rawResultBytes = new TextEncoder().encode(rawResult).length;

    // Step 4: Size cap
    const sizeCap = registered.manifest.sizeCapBytes ?? DEFAULT_SIZE_CAP;
    const capped = capToolResult(rawResult, sizeCap);

    // Step 5: Injection scan
    const scanned = scanToolResult(capped.content);

    // Step 6: COA fingerprint passthrough (COA entry created at invocation DONE, not per tool)
    const coaFingerprint = ctx.coaChainBase;

    const deliveredResultBytes = new TextEncoder().encode(scanned.content).length;

    return {
      toolName,
      rawResultBytes,
      deliveredResultBytes,
      wasTruncated: capped.wasTruncated,
      wasInjectionBlocked: scanned.wasModified,
      coaFingerprint,
      content: scanned.content,
    };
  }

  // ---------------------------------------------------------------------------
  // Worker emission detection
  // ---------------------------------------------------------------------------

  /**
   * Extract worker emissions (q:> lines) from agent response text.
   *
   * @see docs/governance/agent-invocation-spec.md §6.4
   */
  extractTaskmasterEmissions(responseText: string): TaskmasterEmission[] {
    const emissions: TaskmasterEmission[] = [];
    const lines = responseText.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const match = /^q:>\s+(.+)$/.exec(line);
      if (match?.[1] !== undefined) {
        emissions.push({
          description: match[1].trim(),
          lineNumber: i + 1,
        });
      }
    }

    return emissions;
  }

  /**
   * Strip worker emission lines from response text.
   *
   * Per spec: emissions are stripped before delivering to entity,
   * unless entity tier is "sealed" (in which case they are shown).
   */
  stripTaskmasterEmissions(
    responseText: string,
    tier: VerificationTier,
  ): { text: string; strippedCount: number } {
    if (tier === "sealed") {
      return { text: responseText, strippedCount: 0 };
    }

    let strippedCount = 0;
    const cleaned = responseText.replace(WORKER_EMISSION_PATTERN, () => {
      strippedCount++;
      return "";
    });

    const text = cleaned.replace(/\n{3,}/g, "\n\n").trim();
    return { text, strippedCount };
  }
}
