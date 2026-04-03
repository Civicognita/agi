/**
 * Static metadata for all registered workers.
 * Keyed by "domain.worker" identifier (e.g. "code.hacker", "k.linguist").
 */

export interface WorkerMeta {
  description: string;
  purpose: string;
  chainFrom: string[];
  chainTo: string[];
  defaultModel: "haiku" | "sonnet" | "opus";
}

export const WORKER_META: Record<string, WorkerMeta> = {
  // Strategy
  "strat.planner": {
    description: "Strategic planning worker that designs phase plans for task execution.",
    purpose: "Breaks complex tasks into phased execution plans with gate definitions.",
    chainFrom: [],
    chainTo: [],
    defaultModel: "sonnet",
  },
  "strat.prioritizer": {
    description: "Prioritization worker for backlog ordering and urgency assessment.",
    purpose: "Orders work queues by urgency, impact, and dependency analysis.",
    chainFrom: [],
    chainTo: [],
    defaultModel: "haiku",
  },

  // Code
  "code.engineer": {
    description: "Architecture worker that analyzes requirements and produces implementation specs.",
    purpose: "Designs system architecture and creates specs for downstream workers.",
    chainFrom: [],
    chainTo: [],
    defaultModel: "sonnet",
  },
  "code.hacker": {
    description: "Implementation worker that writes code for dispatched tasks.",
    purpose: "Writes production code following specs from engineer or planner.",
    chainFrom: [],
    chainTo: ["code.tester"],
    defaultModel: "sonnet",
  },
  "code.reviewer": {
    description: "Code review worker that examines changes against project standards.",
    purpose: "Checks for security issues, performance concerns, and style violations.",
    chainFrom: [],
    chainTo: [],
    defaultModel: "sonnet",
  },
  "code.tester": {
    description: "Test worker that validates code hacker output with type checks, lint, and tests.",
    purpose: "Runs test suites and reports pass/fail status after hacker completes.",
    chainFrom: ["code.hacker"],
    chainTo: [],
    defaultModel: "sonnet",
  },

  // Communication
  "comm.writer.tech": {
    description: "Technical writing worker for documentation, API docs, and technical content.",
    purpose: "Produces clear technical documentation and API references.",
    chainFrom: [],
    chainTo: ["comm.editor"],
    defaultModel: "sonnet",
  },
  "comm.writer.policy": {
    description: "Policy writing worker for governance documents and organizational guidelines.",
    purpose: "Drafts governance policies, guidelines, and compliance documentation.",
    chainFrom: [],
    chainTo: ["comm.editor"],
    defaultModel: "sonnet",
  },
  "comm.editor": {
    description: "Editing worker that reviews and polishes writer output.",
    purpose: "Refines drafts from writers for clarity, consistency, and correctness.",
    chainFrom: ["comm.writer.tech", "comm.writer.policy"],
    chainTo: [],
    defaultModel: "haiku",
  },

  // Data
  "data.modeler": {
    description: "Data modeling worker for schema design and entity relationship definitions.",
    purpose: "Designs database schemas, entity models, and data structures.",
    chainFrom: [],
    chainTo: ["k.linguist"],
    defaultModel: "sonnet",
  },
  "data.migrator": {
    description: "Data migration worker for schema changes and data transformations.",
    purpose: "Generates and validates migration scripts for schema evolution.",
    chainFrom: [],
    chainTo: [],
    defaultModel: "sonnet",
  },

  // Knowledge
  "k.analyst": {
    description: "Knowledge analysis worker for deep content analysis and pattern extraction.",
    purpose: "Analyzes content, extracts patterns, and generates insights.",
    chainFrom: [],
    chainTo: [],
    defaultModel: "sonnet",
  },
  "k.cryptologist": {
    description: "Cryptology worker for encoding, decoding, and cipher analysis.",
    purpose: "Handles secure communication patterns and cryptographic operations.",
    chainFrom: [],
    chainTo: [],
    defaultModel: "haiku",
  },
  "k.librarian": {
    description: "Knowledge organization worker for cataloging and information retrieval.",
    purpose: "Indexes, catalogs, and optimizes knowledge retrieval systems.",
    chainFrom: [],
    chainTo: [],
    defaultModel: "haiku",
  },
  "k.linguist": {
    description: "Linguistic analysis worker for terminology validation and naming conventions.",
    purpose: "Validates naming consistency and language patterns across the system.",
    chainFrom: ["data.modeler"],
    chainTo: [],
    defaultModel: "sonnet",
  },

  // Governance
  "gov.auditor": {
    description: "Audit worker for compliance checking, security review, and governance validation.",
    purpose: "Performs compliance audits and security reviews against policies.",
    chainFrom: [],
    chainTo: ["gov.archivist"],
    defaultModel: "sonnet",
  },
  "gov.archivist": {
    description: "Archival worker for governance record keeping and compliance documentation.",
    purpose: "Archives audit results and maintains governance records.",
    chainFrom: ["gov.auditor"],
    chainTo: [],
    defaultModel: "haiku",
  },

  // Operations
  "ops.deployer": {
    description: "Deployment worker for release preparation and environment configuration.",
    purpose: "Prepares releases, configures environments, and executes deployments.",
    chainFrom: [],
    chainTo: [],
    defaultModel: "sonnet",
  },
  "ops.custodian": {
    description: "Operations maintenance worker for cleanup tasks and system health.",
    purpose: "Performs routine cleanup, file organization, and system maintenance.",
    chainFrom: [],
    chainTo: [],
    defaultModel: "haiku",
  },
  "ops.syncer": {
    description: "Synchronization worker for state reconciliation and cross-system consistency.",
    purpose: "Keeps data in sync across systems and resolves state drift.",
    chainFrom: [],
    chainTo: [],
    defaultModel: "sonnet",
  },

  // UX
  "ux.designer.web": {
    description: "Web design worker for UI component design and responsive layouts.",
    purpose: "Designs web interfaces, components, and responsive layout patterns.",
    chainFrom: [],
    chainTo: [],
    defaultModel: "sonnet",
  },
  "ux.designer.cli": {
    description: "CLI design worker for terminal interface patterns and command-line UX.",
    purpose: "Designs terminal interfaces, box-drawing layouts, and CLI experiences.",
    chainFrom: [],
    chainTo: [],
    defaultModel: "sonnet",
  },
};

/** Get the domain.worker key from a ReactFlow node ID like "code-hacker" or "comm-writer.tech". */
export function nodeIdToWorkerKey(nodeId: string): string | null {
  const dashIdx = nodeId.indexOf("-");
  if (dashIdx < 0) return null;
  const domain = nodeId.slice(0, dashIdx);
  const worker = nodeId.slice(dashIdx + 1);
  return `${domain}.${worker}`;
}
