// COA — Chain of Accountability — from core/0COA.md

/** Structured COA fingerprint components */
export interface COAFingerprint {
  resource: string; // $A0, $W1, $S0
  entity: string; // #E0, #O0, #T1
  node: string; // @A0
  chain: string; // C001, C010
  work?: string; // W001 (optional work-item suffix)
}

/** COA work action types */
export type COAWorkType =
  | "message_in"
  | "message_out"
  | "tool_use"
  | "task_dispatch"
  | "verification"
  | "artifact"
  | "commit"
  | "action"
  | "mapp_mint"
  | "mapp_install"
  | "mapp_publish"
  | "mapp_execute"
  /** s128 t498: vault entry read at the resolver or API surface. `ref`
   *  carries the entry id; `payloadHash` carries SHA-256 of `entryId|
   *  callerProjectPath` so post-hoc audit can correlate without
   *  storing the project path in plaintext. */
  | "vault_read";

/** Full COA record for persistence */
export interface COARecord {
  fingerprint: string; // "$A0.#O0.@A0.C010"

  resource: {
    id: string;
    name: string;
    type: "agent" | "worker" | "service";
    station?: string;
  };

  entity: {
    id: string;
    name: string;
    type: "individual" | "organization" | "team";
  };

  node: {
    id: string;
    name: string;
    version?: string;
  };

  chain: {
    id: string;
    aid?: string; // Tynn-linked agenda ID
    tid?: string; // Terminal ID
    depth: number;
    parent: string | null;
    fork_id?: string; // Dev mode fork identifier (e.g. "wishborn/aionima")
  };

  work: {
    type: COAWorkType;
    ref: string;
    action: "create" | "update" | "delete";
    ts: string; // ISO-8601
    payloadHash?: string; // SHA-256
  };
}

/** Chain metadata for lineage tracking */
export interface ChainMeta {
  id: string; // C010
  parent: string | null; // C009
  root: string; // C001
  depth: number;
}
