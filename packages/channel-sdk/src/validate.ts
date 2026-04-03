import { z } from "zod";
import {
  ChannelConfigAdapterSchema,
  ChannelGatewayAdapterSchema,
  ChannelOutboundAdapterSchema,
  ChannelMessagingAdapterSchema,
  ChannelSecurityAdapterSchema,
  EntityResolverAdapterSchema,
  ImpactHookAdapterSchema,
  COAEmitterAdapterSchema,
  ChannelMetaSchema,
  ChannelCapabilitiesSchema,
} from "./schemas.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface AdapterValidationError {
  /** e.g. "ChannelConfigAdapter" */
  adapter: string;
  /** e.g. "validate" — omitted when the error is on the adapter itself */
  field?: string;
  /** e.g. "function" */
  expected: string;
  /** e.g. "undefined" */
  received: string;
  /** Human-readable diagnostic */
  message: string;
}

export interface AdapterValidationResult {
  valid: boolean;
  errors: AdapterValidationError[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Stringify a value to a short human-readable type label. */
function typeLabel(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Run a Zod safeParse and convert any ZodError issues into
 * AdapterValidationError entries.
 */
function validateSlot(
  adapterName: string,
  schema: z.ZodTypeAny,
  value: unknown,
  errors: AdapterValidationError[],
): void {
  const result = schema.safeParse(value);
  if (result.success) return;

  const zodError = result.error as z.ZodError;

  for (const issue of zodError.issues) {
    const field = issue.path.length > 0 ? String(issue.path[0]) : undefined;

    // ZodIssue.received and .expected are present on many (but not all) issue
    // subtypes — access them safely via type narrowing on the issue union.
    const received =
      "received" in issue && issue.received !== undefined
        ? String(issue.received)
        : typeLabel(
            field !== undefined && value !== null && typeof value === "object"
              ? (value as Record<string, unknown>)[field]
              : value,
          );

    const expected =
      "expected" in issue && issue.expected !== undefined
        ? String(issue.expected)
        : "unknown";

    const location = field ? `${adapterName}.${field}` : adapterName;

    errors.push({
      adapter: adapterName,
      ...(field !== undefined ? { field } : {}),
      expected,
      received,
      message: `${location}: expected ${expected}, received ${received}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Required adapter slot names and their schemas
// ---------------------------------------------------------------------------

const REQUIRED_ADAPTERS = [
  { key: "config",    name: "ChannelConfigAdapter",    schema: ChannelConfigAdapterSchema },
  { key: "gateway",   name: "ChannelGatewayAdapter",   schema: ChannelGatewayAdapterSchema },
  { key: "outbound",  name: "ChannelOutboundAdapter",  schema: ChannelOutboundAdapterSchema },
  { key: "messaging", name: "ChannelMessagingAdapter", schema: ChannelMessagingAdapterSchema },
] as const;

const OPTIONAL_ADAPTERS = [
  { key: "security",       name: "ChannelSecurityAdapter",  schema: ChannelSecurityAdapterSchema },
  { key: "entityResolver", name: "EntityResolverAdapter",   schema: EntityResolverAdapterSchema },
  { key: "impactHook",     name: "ImpactHookAdapter",       schema: ImpactHookAdapterSchema },
  { key: "coaEmitter",     name: "COAEmitterAdapter",       schema: COAEmitterAdapterSchema },
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate an unknown plugin object against all channel adapter schemas.
 *
 * Required adapters: config, gateway, outbound, messaging.
 * Optional adapters (validated only when present): security, entityResolver,
 * impactHook, coaEmitter.
 * Top-level meta and capabilities are also validated when present.
 *
 * Uses Zod safeParse — never throws. All issues are collected and returned.
 *
 * @example
 * const result = validateAdapter(plugin);
 * if (!result.valid) {
 *   for (const err of result.errors) console.error(err.message);
 * }
 */
export function validateAdapter(plugin: unknown): AdapterValidationResult {
  const errors: AdapterValidationError[] = [];

  if (plugin === null || typeof plugin !== "object") {
    errors.push({
      adapter: "AionimaChannelPlugin",
      expected: "object",
      received: typeLabel(plugin),
      message: `AionimaChannelPlugin: expected object, received ${typeLabel(plugin)}`,
    });
    return { valid: false, errors };
  }

  const obj = plugin as Record<string, unknown>;

  // Validate top-level meta and capabilities when present
  if ("meta" in obj) {
    validateSlot("ChannelMeta", ChannelMetaSchema, obj["meta"], errors);
  }
  if ("capabilities" in obj) {
    validateSlot("ChannelCapabilities", ChannelCapabilitiesSchema, obj["capabilities"], errors);
  }

  // Required adapters — must exist and be valid
  for (const { key, name, schema } of REQUIRED_ADAPTERS) {
    if (!(key in obj)) {
      errors.push({
        adapter: name,
        expected: "object",
        received: "undefined",
        message: `${name}: expected object, received undefined`,
      });
      continue;
    }
    validateSlot(name, schema, obj[key], errors);
  }

  // Optional adapters — only validated when the key is present
  for (const { key, name, schema } of OPTIONAL_ADAPTERS) {
    if (key in obj) {
      validateSlot(name, schema, obj[key], errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Assert that a plugin is valid, throwing a descriptive error when not.
 *
 * Intended for gateway startup where an invalid plugin is unrecoverable.
 *
 * @throws {Error} Lists every validation issue in the error message.
 *
 * @example
 * assertValidAdapter(plugin); // throws if invalid, passes through otherwise
 */
export function assertValidAdapter(plugin: unknown): void {
  const result = validateAdapter(plugin);
  if (result.valid) return;

  const lines = result.errors.map((e) => `  - ${e.message}`);
  throw new Error(
    `Invalid channel plugin (${result.errors.length} error${result.errors.length === 1 ? "" : "s"}):\n${lines.join("\n")}`
  );
}
