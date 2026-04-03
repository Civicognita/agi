import type { COAFingerprint } from "./types.js";

// Validation patterns for each COA fingerprint segment
const RESOURCE_RE = /^\$[A-Z]\d+$/;
const ENTITY_RE = /^#[A-Z]\d+$/;
const NODE_RE = /^@[A-Z]\d+$/;
const CHAIN_RE = /^C\d+$/;
const WORK_RE = /^W\d+$/;

function validateResource(value: string): void {
  if (!RESOURCE_RE.test(value)) {
    throw new Error(
      `Invalid COA resource "${value}": must start with $ followed by a letter and digits (e.g. $A0, $W1)`
    );
  }
}

function validateEntity(value: string): void {
  if (!ENTITY_RE.test(value)) {
    throw new Error(
      `Invalid COA entity "${value}": must start with # followed by a letter and digits (e.g. #E0, #O0)`
    );
  }
}

function validateNode(value: string): void {
  if (!NODE_RE.test(value)) {
    throw new Error(
      `Invalid COA node "${value}": must start with @ followed by a letter and digits (e.g. @A0)`
    );
  }
}

function validateChain(value: string): void {
  if (!CHAIN_RE.test(value)) {
    throw new Error(
      `Invalid COA chain "${value}": must start with C followed by digits (e.g. C001, C010)`
    );
  }
}

function validateWork(value: string): void {
  if (!WORK_RE.test(value)) {
    throw new Error(
      `Invalid COA work "${value}": must start with W followed by digits (e.g. W001)`
    );
  }
}

/**
 * Format a structured COA fingerprint into a string.
 * Throws if any segment fails prefix validation.
 *
 * @example
 * formatFingerprint({ resource: "$A0", entity: "#O0", node: "@A0", chain: "C010" })
 * // => "$A0.#O0.@A0.C010"
 *
 * @example
 * formatFingerprint({ resource: "$W1", entity: "#E0", node: "@A0", chain: "C010", work: "W001" })
 * // => "$W1.#E0.@A0.C010.W001"
 */
export function formatFingerprint(fp: COAFingerprint): string {
  validateResource(fp.resource);
  validateEntity(fp.entity);
  validateNode(fp.node);
  validateChain(fp.chain);
  if (fp.work !== undefined) {
    validateWork(fp.work);
  }

  const base = `${fp.resource}.${fp.entity}.${fp.node}.${fp.chain}`;
  return fp.work ? `${base}.${fp.work}` : base;
}

/**
 * Parse a COA fingerprint string into structured components.
 * Throws if the string doesn't match the expected format.
 *
 * @example
 * parseFingerprint("$A0.#O0.@A0.C010")
 * // => { resource: "$A0", entity: "#O0", node: "@A0", chain: "C010" }
 *
 * @example
 * parseFingerprint("$A0.#E0.@A0.C010.W001")
 * // => { resource: "$A0", entity: "#E0", node: "@A0", chain: "C010", work: "W001" }
 */
export function parseFingerprint(raw: string): COAFingerprint {
  const parts = raw.split(".");

  if (parts.length !== 4 && parts.length !== 5) {
    throw new Error(
      `Invalid COA fingerprint "${raw}": expected 4 or 5 dot-separated segments, got ${parts.length}`
    );
  }

  const [resource, entity, node, chain, work] = parts as [
    string,
    string,
    string,
    string,
    string | undefined,
  ];

  validateResource(resource);
  validateEntity(entity);
  validateNode(node);
  validateChain(chain);
  if (work !== undefined) {
    validateWork(work);
  }

  return {
    resource,
    entity,
    node,
    chain,
    ...(work !== undefined ? { work } : {}),
  };
}

/**
 * Increment a chain ID string, preserving zero-padding to at least 3 digits.
 * Grows width beyond 3 digits as needed.
 *
 * @example
 * nextChainId("C009") // => "C010"
 * nextChainId("C099") // => "C100"
 * nextChainId("C999") // => "C1000"
 */
export function nextChainId(current: string): string {
  return incrementPrefixedId("C", current);
}

/**
 * Increment a work ID string, preserving zero-padding to at least 3 digits.
 * Grows width beyond 3 digits as needed.
 *
 * @example
 * nextWorkId("W009") // => "W010"
 * nextWorkId("W099") // => "W100"
 * nextWorkId("W999") // => "W1000"
 */
export function nextWorkId(current: string): string {
  return incrementPrefixedId("W", current);
}

function incrementPrefixedId(prefix: string, current: string): string {
  if (!current.startsWith(prefix)) {
    throw new Error(
      `Expected "${current}" to start with prefix "${prefix}"`
    );
  }

  const numericPart = current.slice(prefix.length);
  if (!/^\d+$/.test(numericPart)) {
    throw new Error(
      `Expected "${current}" to have a numeric suffix after "${prefix}", got "${numericPart}"`
    );
  }

  const next = parseInt(numericPart, 10) + 1;
  const minWidth = Math.max(3, numericPart.length);
  const padded = String(next).padStart(minWidth, "0");
  return `${prefix}${padded}`;
}
