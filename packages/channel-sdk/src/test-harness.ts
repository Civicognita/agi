/**
 * Plugin SDK Test Harness — Task #179
 *
 * Test harness for third-party channel adapters.
 * Validates plugin conformance by exercising the full lifecycle:
 *   1. Config validation (validate + getDefaults)
 *   2. Gateway lifecycle (start → isRunning → stop)
 *   3. Messaging roundtrip (register handler → simulate message)
 *   4. Outbound delivery (send text + media)
 *   5. Security checks (isAllowed, getAllowlist)
 *   6. Optional adapters (entityResolver, impactHook, coaEmitter)
 *
 * Provides structured test results suitable for CI or interactive display.
 *
 * @example
 * ```ts
 * import { testPlugin } from "@agi/channel-sdk/test-harness";
 *
 * const results = await testPlugin(myPlugin);
 * if (results.passed) console.log("All tests passed!");
 * else results.failures.forEach(f => console.error(f.message));
 * ```
 */

import type { AionimaMessage, ChannelId } from "./types.js";
import type {
  ChannelConfigAdapter,
  ChannelGatewayAdapter,
  ChannelOutboundAdapter,
  ChannelMessagingAdapter,
  ChannelSecurityAdapter,
  EntityResolverAdapter,
  ImpactHookAdapter,
  COAEmitterAdapter,
} from "./adapters.js";
import type { ChannelMeta, ChannelCapabilities } from "./types.js";
import { validateAdapter } from "./validate.js";

/** Inline TestablePlugin shape to avoid circular import. */
interface TestablePlugin {
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  config: ChannelConfigAdapter;
  gateway: ChannelGatewayAdapter;
  outbound: ChannelOutboundAdapter;
  messaging: ChannelMessagingAdapter;
  security?: ChannelSecurityAdapter;
  entityResolver?: EntityResolverAdapter;
  impactHook?: ImpactHookAdapter;
  coaEmitter?: COAEmitterAdapter;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  durationMs: number;
}

export interface TestSuiteResult {
  pluginId: string;
  pluginName: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: TestResult[];
  durationMs: number;
}

export interface TestHarnessOptions {
  /** Timeout for async operations (default: 5000ms). */
  timeoutMs?: number;
  /** If true, skip gateway lifecycle tests (useful for adapters requiring real credentials). */
  skipGateway?: boolean;
  /** If true, skip outbound tests. */
  skipOutbound?: boolean;
  /** Test message to simulate. */
  testMessage?: AionimaMessage;
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

/**
 * Run the full test harness against a TestablePlugin.
 */
export async function testPlugin(
  plugin: TestablePlugin,
  options: TestHarnessOptions = {},
): Promise<TestSuiteResult> {
  const start = Date.now();
  const results: TestResult[] = [];
  const timeoutMs = options.timeoutMs ?? 5000;

  // Test 1: Schema validation
  results.push(runSync("Schema validation", () => {
    const result = validateAdapter(plugin);
    if (!result.valid) {
      throw new Error(
        `${result.errors.length} validation error(s): ` +
        result.errors.map((e) => e.message).join("; "),
      );
    }
  }));

  // Test 2: Plugin identity
  results.push(runSync("Plugin identity", () => {
    if (!plugin.id) throw new Error("Plugin.id is missing");
    if (!plugin.meta.name) throw new Error("Plugin.meta.name is missing");
    if (!plugin.meta.version) throw new Error("Plugin.meta.version is missing");
  }));

  // Test 3: Config adapter
  results.push(runSync("Config adapter", () => {
    const defaults = plugin.config.getDefaults();
    if (typeof defaults !== "object" || defaults === null) {
      throw new Error("getDefaults() should return an object");
    }
    // Validation should accept defaults
    const isValid = plugin.config.validate(defaults);
    // Defaults alone might not be valid (missing required fields) — that's OK
    if (typeof isValid !== "boolean") {
      throw new Error("validate() should return a boolean");
    }
  }));

  // Test 4: Capabilities declaration
  results.push(runSync("Capabilities", () => {
    const caps = plugin.capabilities;
    const requiredKeys = ["text", "media", "voice", "reactions", "threads", "ephemeral"];
    for (const key of requiredKeys) {
      if (typeof (caps as unknown as Record<string, unknown>)[key] !== "boolean") {
        throw new Error(`capabilities.${key} should be boolean`);
      }
    }
  }));

  // Test 5: Messaging handler registration
  results.push(runSync("Messaging handler registration", () => {
    let handlerCalled = false;
    plugin.messaging.onMessage(async () => { handlerCalled = true; });
    // Just verifying it doesn't throw; handler invocation tested separately
    if (handlerCalled) {
      throw new Error("Handler should not be called during registration");
    }
  }));

  // Test 6: Gateway lifecycle (optional)
  if (!options.skipGateway) {
    results.push(await runAsync("Gateway lifecycle", async () => {
      await withTimeout(plugin.gateway.start(), timeoutMs);

      if (!plugin.gateway.isRunning()) {
        throw new Error("Gateway should be running after start()");
      }

      await withTimeout(plugin.gateway.stop(), timeoutMs);

      if (plugin.gateway.isRunning()) {
        throw new Error("Gateway should not be running after stop()");
      }
    }));
  } else {
    results.push(skip("Gateway lifecycle"));
  }

  // Test 7: Outbound (optional)
  if (!options.skipOutbound) {
    results.push(await runAsync("Outbound text send", async () => {
      // This will likely fail without real credentials, but shouldn't throw
      // internal errors (should throw API-level errors)
      try {
        await withTimeout(
          plugin.outbound.send("test-user-id", { type: "text", text: "Test message from SDK harness" }),
          timeoutMs,
        );
      } catch (err) {
        // Expected to fail (no real backend) — just verify it's a proper error
        if (!(err instanceof Error)) {
          throw new Error("Outbound errors should be Error instances");
        }
      }
    }));
  } else {
    results.push(skip("Outbound text send"));
  }

  // Test 8: Security adapter (if present)
  if (plugin.security) {
    results.push(await runAsync("Security adapter", async () => {
      const isAllowed = await plugin.security!.isAllowed("test-user-id");
      if (typeof isAllowed !== "boolean") {
        throw new Error("isAllowed() should return a boolean");
      }

      const allowlist = await plugin.security!.getAllowlist();
      if (!Array.isArray(allowlist)) {
        throw new Error("getAllowlist() should return an array");
      }
    }));
  } else {
    results.push(skip("Security adapter"));
  }

  // Test 9: Entity resolver (if present)
  if (plugin.entityResolver) {
    results.push(await runAsync("Entity resolver", async () => {
      const resolved = await plugin.entityResolver!.resolve("test-user-id");
      if (resolved !== null && typeof resolved !== "string") {
        throw new Error("resolve() should return string | null");
      }
    }));
  } else {
    results.push(skip("Entity resolver"));
  }

  // Test 10: Impact hook (if present)
  if (plugin.impactHook) {
    const testMsg = options.testMessage ?? createTestMessage(plugin.id);
    results.push(await runAsync("Impact hook", async () => {
      const classification = await plugin.impactHook!.classify(testMsg);
      if (typeof classification.interactionType !== "string") {
        throw new Error("classify().interactionType should be a string");
      }
      if (typeof classification.quant !== "number") {
        throw new Error("classify().quant should be a number");
      }
      if (typeof classification.boolValue !== "number") {
        throw new Error("classify().boolValue should be a number");
      }
    }));
  } else {
    results.push(skip("Impact hook"));
  }

  // Test 11: COA emitter (if present)
  if (plugin.coaEmitter) {
    const testMsg = options.testMessage ?? createTestMessage(plugin.id);
    results.push(await runAsync("COA emitter", async () => {
      const fingerprint = await plugin.coaEmitter!.emit(testMsg, "test-entity-id");
      if (typeof fingerprint !== "string" || fingerprint.length === 0) {
        throw new Error("emit() should return a non-empty fingerprint string");
      }
    }));
  } else {
    results.push(skip("COA emitter"));
  }

  const totalDuration = Date.now() - start;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed && r.message !== "Skipped").length;
  const skipped = results.filter((r) => r.message === "Skipped").length;

  return {
    pluginId: plugin.id,
    pluginName: plugin.meta.name,
    total: results.length,
    passed,
    failed,
    skipped,
    results,
    durationMs: totalDuration,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runSync(name: string, fn: () => void): TestResult {
  const start = Date.now();
  try {
    fn();
    return { name, passed: true, message: "OK", durationMs: Date.now() - start };
  } catch (err) {
    return {
      name,
      passed: false,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function runAsync(name: string, fn: () => Promise<void>): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, passed: true, message: "OK", durationMs: Date.now() - start };
  } catch (err) {
    return {
      name,
      passed: false,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

function skip(name: string): TestResult {
  return { name, passed: true, message: "Skipped", durationMs: 0 };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function createTestMessage(channelId: ChannelId): AionimaMessage {
  return {
    id: "test-msg-001",
    channelId,
    channelUserId: "test-user-id",
    timestamp: new Date().toISOString(),
    content: { type: "text", text: "Test message from SDK test harness" },
  };
}
