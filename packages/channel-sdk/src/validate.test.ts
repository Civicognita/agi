import { describe, it, expect, vi } from "vitest";
import type { AdapterValidationError } from "./validate.js";
import { validateAdapter, assertValidAdapter } from "./validate.js";

// ---------------------------------------------------------------------------
// Mock plugin factory
// ---------------------------------------------------------------------------

/**
 * Returns a fully valid AionimaChannelPlugin-shaped object with vi.fn() stubs
 * for all function slots. Tests spread/override individual adapters.
 */
function buildMockPlugin(): Record<string, unknown> {
  return {
    meta: {
      name: "test-channel",
      version: "1.0.0",
      description: "A test channel plugin",
      author: "Test Author",
    },
    capabilities: {
      text: true,
      media: false,
      voice: false,
      reactions: false,
      threads: false,
      ephemeral: false,
    },
    config: {
      validate: vi.fn(),
      getDefaults: vi.fn(),
    },
    gateway: {
      start: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn(),
    },
    outbound: {
      send: vi.fn(),
    },
    messaging: {
      onMessage: vi.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Valid plugin passes
// ---------------------------------------------------------------------------

describe("validateAdapter — valid plugin", () => {
  it("returns { valid: true, errors: [] } for a fully valid plugin", () => {
    const plugin = buildMockPlugin();
    const result = validateAdapter(plugin);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Valid plugin with optional adapters
// ---------------------------------------------------------------------------

describe("validateAdapter — valid plugin with optional adapters", () => {
  it("accepts all optional adapters when they are well-formed", () => {
    const plugin = {
      ...buildMockPlugin(),
      security: {
        isAllowed: vi.fn(),
        getAllowlist: vi.fn(),
      },
      entityResolver: {
        resolve: vi.fn(),
        createUnverified: vi.fn(),
      },
      impactHook: {
        classify: vi.fn(),
      },
      coaEmitter: {
        emit: vi.fn(),
      },
    };

    const result = validateAdapter(plugin);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Missing required adapters — one at a time
// ---------------------------------------------------------------------------

describe("validateAdapter — missing required adapters", () => {
  const requiredKeys: Array<{ key: string; adapterName: string }> = [
    { key: "config",    adapterName: "ChannelConfigAdapter" },
    { key: "gateway",   adapterName: "ChannelGatewayAdapter" },
    { key: "outbound",  adapterName: "ChannelOutboundAdapter" },
    { key: "messaging", adapterName: "ChannelMessagingAdapter" },
  ];

  for (const { key, adapterName } of requiredKeys) {
    it(`reports an error when '${key}' adapter is missing`, () => {
      const plugin = buildMockPlugin();
      delete (plugin as Record<string, unknown>)[key];

      const result = validateAdapter(plugin);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);

      const err = result.errors.find((e) => e.adapter === adapterName);
      expect(err).toBeDefined();
      expect(err!.expected).toBe("object");
      expect(err!.received).toBe("undefined");
      expect(err!.message).toContain(adapterName);
      expect(err!.message).toContain("expected object, received undefined");
    });
  }
});

// ---------------------------------------------------------------------------
// 4. All required adapters missing
// ---------------------------------------------------------------------------

describe("validateAdapter — all required adapters missing", () => {
  it("returns 4 errors when no required adapters are present", () => {
    const result = validateAdapter({});

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(4);

    const adapterNames = result.errors.map((e) => e.adapter);
    expect(adapterNames).toContain("ChannelConfigAdapter");
    expect(adapterNames).toContain("ChannelGatewayAdapter");
    expect(adapterNames).toContain("ChannelOutboundAdapter");
    expect(adapterNames).toContain("ChannelMessagingAdapter");
  });
});

// ---------------------------------------------------------------------------
// 5. Non-object inputs
// ---------------------------------------------------------------------------

describe("validateAdapter — non-object inputs", () => {
  const nonObjects: Array<{ label: string; value: unknown; expectedReceived: string }> = [
    { label: "null",      value: null,      expectedReceived: "null" },
    { label: "undefined", value: undefined, expectedReceived: "undefined" },
    { label: "42",        value: 42,        expectedReceived: "number" },
    { label: "'string'",  value: "string",  expectedReceived: "string" },
  ];

  for (const { label, value, expectedReceived } of nonObjects) {
    it(`returns a AionimaChannelPlugin object error for ${label}`, () => {
      const result = validateAdapter(value);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);

      const err = result.errors[0] as AdapterValidationError;
      expect(err.adapter).toBe("AionimaChannelPlugin");
      expect(err.expected).toBe("object");
      expect(err.received).toBe(expectedReceived);
      expect(err.message).toContain("AionimaChannelPlugin: expected object");
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Invalid adapter shape — config missing its required functions
// ---------------------------------------------------------------------------

describe("validateAdapter — invalid adapter shape", () => {
  it("reports errors referencing ChannelConfigAdapter when config is an empty object", () => {
    const plugin = {
      ...buildMockPlugin(),
      config: {},
    };

    const result = validateAdapter(plugin);

    expect(result.valid).toBe(false);

    const configErrors = result.errors.filter((e) => e.adapter === "ChannelConfigAdapter");
    expect(configErrors.length).toBeGreaterThanOrEqual(1);

    for (const err of configErrors) {
      expect(err.message).toContain("ChannelConfigAdapter");
    }
  });

  it("reports missing validate and getDefaults fields on config: {}", () => {
    const plugin = {
      ...buildMockPlugin(),
      config: {},
    };

    const result = validateAdapter(plugin);
    const configErrors = result.errors.filter((e) => e.adapter === "ChannelConfigAdapter");

    const fields = configErrors.map((e) => e.field).filter(Boolean);
    expect(fields).toContain("validate");
    expect(fields).toContain("getDefaults");
  });
});

// ---------------------------------------------------------------------------
// 7. Strict mode — extra fields on required adapters are rejected
// ---------------------------------------------------------------------------

describe("validateAdapter — strict mode rejects extra fields", () => {
  it("rejects config with an extra unknown property", () => {
    const plugin = {
      ...buildMockPlugin(),
      config: {
        validate: vi.fn(),
        getDefaults: vi.fn(),
        extra: true,
      },
    };

    const result = validateAdapter(plugin);
    expect(result.valid).toBe(false);

    const configErrors = result.errors.filter((e) => e.adapter === "ChannelConfigAdapter");
    expect(configErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects gateway with an extra unknown property", () => {
    const plugin = {
      ...buildMockPlugin(),
      gateway: {
        start: vi.fn(),
        stop: vi.fn(),
        isRunning: vi.fn(),
        unknownField: "oops",
      },
    };

    const result = validateAdapter(plugin);
    expect(result.valid).toBe(false);

    const gatewayErrors = result.errors.filter((e) => e.adapter === "ChannelGatewayAdapter");
    expect(gatewayErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects outbound with an extra unknown property", () => {
    const plugin = {
      ...buildMockPlugin(),
      outbound: {
        send: vi.fn(),
        bonus: true,
      },
    };

    const result = validateAdapter(plugin);
    expect(result.valid).toBe(false);

    const outboundErrors = result.errors.filter((e) => e.adapter === "ChannelOutboundAdapter");
    expect(outboundErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects messaging with an extra unknown property", () => {
    const plugin = {
      ...buildMockPlugin(),
      messaging: {
        onMessage: vi.fn(),
        extraKey: 99,
      },
    };

    const result = validateAdapter(plugin);
    expect(result.valid).toBe(false);

    const messagingErrors = result.errors.filter((e) => e.adapter === "ChannelMessagingAdapter");
    expect(messagingErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects optional security adapter with an extra unknown property", () => {
    const plugin = {
      ...buildMockPlugin(),
      security: {
        isAllowed: vi.fn(),
        getAllowlist: vi.fn(),
        extra: "nope",
      },
    };

    const result = validateAdapter(plugin);
    expect(result.valid).toBe(false);

    const securityErrors = result.errors.filter((e) => e.adapter === "ChannelSecurityAdapter");
    expect(securityErrors.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Individual adapter interface schemas
// ---------------------------------------------------------------------------

describe("validateAdapter — adapter schemas individually", () => {
  it("ChannelConfigAdapter: requires validate and getDefaults as functions", () => {
    const base = buildMockPlugin();

    // Both present — valid
    expect(validateAdapter(base).valid).toBe(true);

    // Missing validate
    const missingValidate = {
      ...buildMockPlugin(),
      config: { getDefaults: vi.fn() },
    };
    const r1 = validateAdapter(missingValidate);
    expect(r1.valid).toBe(false);
    const e1 = r1.errors.find((e) => e.adapter === "ChannelConfigAdapter" && e.field === "validate");
    expect(e1).toBeDefined();

    // Missing getDefaults
    const missingDefaults = {
      ...buildMockPlugin(),
      config: { validate: vi.fn() },
    };
    const r2 = validateAdapter(missingDefaults);
    expect(r2.valid).toBe(false);
    const e2 = r2.errors.find((e) => e.adapter === "ChannelConfigAdapter" && e.field === "getDefaults");
    expect(e2).toBeDefined();
  });

  it("ChannelGatewayAdapter: requires start, stop, and isRunning as functions", () => {
    const missingStart = {
      ...buildMockPlugin(),
      gateway: { stop: vi.fn(), isRunning: vi.fn() },
    };
    const r1 = validateAdapter(missingStart);
    expect(r1.valid).toBe(false);
    expect(r1.errors.find((e) => e.adapter === "ChannelGatewayAdapter" && e.field === "start")).toBeDefined();

    const missingStop = {
      ...buildMockPlugin(),
      gateway: { start: vi.fn(), isRunning: vi.fn() },
    };
    const r2 = validateAdapter(missingStop);
    expect(r2.valid).toBe(false);
    expect(r2.errors.find((e) => e.adapter === "ChannelGatewayAdapter" && e.field === "stop")).toBeDefined();

    const missingIsRunning = {
      ...buildMockPlugin(),
      gateway: { start: vi.fn(), stop: vi.fn() },
    };
    const r3 = validateAdapter(missingIsRunning);
    expect(r3.valid).toBe(false);
    expect(r3.errors.find((e) => e.adapter === "ChannelGatewayAdapter" && e.field === "isRunning")).toBeDefined();
  });

  it("ChannelOutboundAdapter: requires send as a function", () => {
    const plugin = {
      ...buildMockPlugin(),
      outbound: {},
    };
    const result = validateAdapter(plugin);
    expect(result.valid).toBe(false);
    expect(result.errors.find((e) => e.adapter === "ChannelOutboundAdapter" && e.field === "send")).toBeDefined();
  });

  it("ChannelMessagingAdapter: requires onMessage as a function", () => {
    const plugin = {
      ...buildMockPlugin(),
      messaging: {},
    };
    const result = validateAdapter(plugin);
    expect(result.valid).toBe(false);
    expect(result.errors.find((e) => e.adapter === "ChannelMessagingAdapter" && e.field === "onMessage")).toBeDefined();
  });

  it("ChannelSecurityAdapter: requires isAllowed and getAllowlist as functions", () => {
    const missingIsAllowed = {
      ...buildMockPlugin(),
      security: { getAllowlist: vi.fn() },
    };
    const r1 = validateAdapter(missingIsAllowed);
    expect(r1.valid).toBe(false);
    expect(r1.errors.find((e) => e.adapter === "ChannelSecurityAdapter" && e.field === "isAllowed")).toBeDefined();

    const missingGetAllowlist = {
      ...buildMockPlugin(),
      security: { isAllowed: vi.fn() },
    };
    const r2 = validateAdapter(missingGetAllowlist);
    expect(r2.valid).toBe(false);
    expect(r2.errors.find((e) => e.adapter === "ChannelSecurityAdapter" && e.field === "getAllowlist")).toBeDefined();
  });

  it("EntityResolverAdapter: requires resolve and createUnverified as functions", () => {
    const missingResolve = {
      ...buildMockPlugin(),
      entityResolver: { createUnverified: vi.fn() },
    };
    const r1 = validateAdapter(missingResolve);
    expect(r1.valid).toBe(false);
    expect(r1.errors.find((e) => e.adapter === "EntityResolverAdapter" && e.field === "resolve")).toBeDefined();

    const missingCreateUnverified = {
      ...buildMockPlugin(),
      entityResolver: { resolve: vi.fn() },
    };
    const r2 = validateAdapter(missingCreateUnverified);
    expect(r2.valid).toBe(false);
    expect(r2.errors.find((e) => e.adapter === "EntityResolverAdapter" && e.field === "createUnverified")).toBeDefined();
  });

  it("ImpactHookAdapter: requires classify as a function", () => {
    const plugin = {
      ...buildMockPlugin(),
      impactHook: {},
    };
    const result = validateAdapter(plugin);
    expect(result.valid).toBe(false);
    expect(result.errors.find((e) => e.adapter === "ImpactHookAdapter" && e.field === "classify")).toBeDefined();
  });

  it("COAEmitterAdapter: requires emit as a function", () => {
    const plugin = {
      ...buildMockPlugin(),
      coaEmitter: {},
    };
    const result = validateAdapter(plugin);
    expect(result.valid).toBe(false);
    expect(result.errors.find((e) => e.adapter === "COAEmitterAdapter" && e.field === "emit")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 9. Diagnostic error messages
// ---------------------------------------------------------------------------

describe("validateAdapter — diagnostic error messages", () => {
  it("error messages include the adapter name", () => {
    const plugin = {
      ...buildMockPlugin(),
      config: {},
      gateway: {},
    };
    const result = validateAdapter(plugin);

    for (const err of result.errors) {
      expect(err.message).toContain(err.adapter);
    }
  });

  it("error messages are human-readable and include both expected and received", () => {
    const result = validateAdapter(null);
    const err = result.errors[0] as AdapterValidationError;

    expect(err.message).toMatch(/expected/i);
    expect(err.message).toMatch(/received/i);
  });

  it("field-level errors include the field path in the message", () => {
    const plugin = {
      ...buildMockPlugin(),
      config: {},
    };
    const result = validateAdapter(plugin);
    const validateErr = result.errors.find(
      (e) => e.adapter === "ChannelConfigAdapter" && e.field === "validate",
    );

    expect(validateErr).toBeDefined();
    expect(validateErr!.message).toContain("ChannelConfigAdapter.validate");
  });

  it("error objects include adapter, expected, received, and message fields", () => {
    const result = validateAdapter({});
    for (const err of result.errors) {
      expect(typeof err.adapter).toBe("string");
      expect(typeof err.expected).toBe("string");
      expect(typeof err.received).toBe("string");
      expect(typeof err.message).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// 10. assertValidAdapter
// ---------------------------------------------------------------------------

describe("assertValidAdapter", () => {
  it("does not throw for a fully valid plugin", () => {
    expect(() => assertValidAdapter(buildMockPlugin())).not.toThrow();
  });

  it("does not throw when all optional adapters are also valid", () => {
    const plugin = {
      ...buildMockPlugin(),
      security: { isAllowed: vi.fn(), getAllowlist: vi.fn() },
      entityResolver: { resolve: vi.fn(), createUnverified: vi.fn() },
      impactHook: { classify: vi.fn() },
      coaEmitter: { emit: vi.fn() },
    };
    expect(() => assertValidAdapter(plugin)).not.toThrow();
  });

  it("throws an Error instance for an invalid plugin", () => {
    expect(() => assertValidAdapter(null)).toThrow(Error);
  });

  it("throws with all validation issues listed in the error message", () => {
    let thrown: Error | null = null;
    try {
      assertValidAdapter({});
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("ChannelConfigAdapter");
    expect(thrown!.message).toContain("ChannelGatewayAdapter");
    expect(thrown!.message).toContain("ChannelOutboundAdapter");
    expect(thrown!.message).toContain("ChannelMessagingAdapter");
  });

  it("error message includes the count of errors", () => {
    let thrown: Error | null = null;
    try {
      assertValidAdapter({});
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    // Should mention "4 errors" (one per missing required adapter)
    expect(thrown!.message).toMatch(/4 error/);
  });

  it("uses singular 'error' when there is exactly one issue", () => {
    // Remove config so exactly 1 required adapter is missing
    const raw = { ...buildMockPlugin() };
    delete raw["config"];

    let thrown: Error | null = null;
    try {
      assertValidAdapter(raw);
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toMatch(/1 error[^s]/);
  });

  it("error message formats each issue as a dash-prefixed line", () => {
    let thrown: Error | null = null;
    try {
      assertValidAdapter(null);
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("  - ");
  });

  it("throws for a non-object input (number)", () => {
    expect(() => assertValidAdapter(42)).toThrow(/AionimaChannelPlugin/);
  });

  it("throws for a non-object input (string)", () => {
    expect(() => assertValidAdapter("bad")).toThrow(/AionimaChannelPlugin/);
  });
});
