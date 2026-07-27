/**
 * HTTP client for communicating with a running aionima gateway.
 */

/** Shape of the /api/status response from the gateway */
export interface GatewayStatus {
  state: string;
  uptime: number;
  channels: Array<{ id: string; status: string }>;
  entities: number;
  queueDepth: number;
  connections: number;
}

/** Shape of the /api/health response from the gateway */
export interface HealthCheck {
  name: string;
  ok: boolean;
  message?: string;
}

/** Shape of the /api/lemonade/status response from the gateway (K.7). */
export interface LemonadeStatus {
  installed?: boolean;
  running?: boolean;
  version?: string;
  devices?: {
    amd_npu?: { available?: boolean } | null;
    amd_igpu?: { available?: boolean } | null;
    cpu?: { available?: boolean } | null;
  } | null;
  activeModel?: string | null;
}

/** Shape of one /api/chat/sessions entry (chat-persistence.ts ChatSessionSummary). */
export interface ChatSessionSummary {
  id: string;
  context: string;
  contextLabel: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastPreview: string;
}

/** Shape of one /api/taskmaster/jobs[/:jobId] entry (worker-api.ts JobSummary). */
export interface TaskmasterJobSummary {
  id: string;
  description: string;
  status: "pending" | "running" | "checkpoint" | "complete" | "failed";
  currentPhase: string | null;
  workers: string[];
  gate: "auto" | "checkpoint" | "terminal";
  createdAt: string;
  summary?: string;
  completedAt?: string;
  error?: string;
}

export class GatewayClient {
  private readonly baseUrl: string;

  constructor(host: string, port: number) {
    this.baseUrl = `http://${host}:${port}`;
  }

  /** Check if the gateway is reachable */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/status`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Get gateway status */
  async status(): Promise<GatewayStatus> {
    const res = await this.fetch("/api/status");
    return res as GatewayStatus;
  }

  /** Get health checks */
  async health(): Promise<HealthCheck[]> {
    const res = await this.fetch("/api/health");
    return res as HealthCheck[];
  }

  /**
   * Get Lemonade runtime status. Returns null when the proxy endpoint 503s
   * (runtime plugin not installed) or the gateway is unreachable. Used by
   * `agi doctor` for the K.7 Lemonade check group.
   */
  async lemonadeStatus(): Promise<LemonadeStatus | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/lemonade/status`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      return (await res.json()) as LemonadeStatus;
    } catch {
      return null;
    }
  }

  /** List Taskmaster jobs, scoped to a project when `projectPath` is given (server-side filter). */
  async taskmasterJobs(projectPath?: string): Promise<TaskmasterJobSummary[]> {
    const qs = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : "";
    const res = await this.fetch(`/api/taskmaster/jobs${qs}`);
    return res as TaskmasterJobSummary[];
  }

  /** Fetch one job's detail. Returns `{status:"not_found"}` if it doesn't exist — never throws for that case. */
  async taskmasterJob(jobId: string): Promise<TaskmasterJobSummary | { id: string; status: "not_found" }> {
    const res = await this.fetch(`/api/taskmaster/jobs/${encodeURIComponent(jobId)}`);
    return res as TaskmasterJobSummary | { id: string; status: "not_found" };
  }

  /** Approve a paused checkpoint gate, resuming the job at its next phase. */
  async approveTaskmasterJob(jobId: string): Promise<void> {
    await this.post(`/api/taskmaster/approve/${encodeURIComponent(jobId)}`);
  }

  /** Reject a paused checkpoint gate, marking the job failed. */
  async rejectTaskmasterJob(jobId: string, reason?: string): Promise<void> {
    await this.post(`/api/taskmaster/reject/${encodeURIComponent(jobId)}`, reason ? { reason } : undefined);
  }

  /** List saved chat sessions (global + s130-migrated per-project, server-side). Used by `agi chat` to auto-resume the most recent session for a container. */
  async chatSessions(): Promise<ChatSessionSummary[]> {
    const res = (await this.fetch("/api/chat/sessions")) as { sessions: ChatSessionSummary[] };
    return res.sessions;
  }

  private async fetch(path: string): Promise<unknown> {
    let res: Response;

    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new GatewayUnreachableError(this.baseUrl);
    }

    if (!res.ok) {
      throw new Error(`Gateway returned ${String(res.status)}: ${await res.text()}`);
    }

    return res.json();
  }

  private async post(path: string, body?: unknown): Promise<unknown> {
    let res: Response;

    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new GatewayUnreachableError(this.baseUrl);
    }

    if (!res.ok) {
      throw new Error(`Gateway returned ${String(res.status)}: ${await res.text()}`);
    }

    return res.json();
  }
}

export class GatewayUnreachableError extends Error {
  constructor(url: string) {
    super(
      `Cannot reach gateway at ${url}.\n` +
        `  Is the gateway running? Start it with: aionima run`,
    );
    this.name = "GatewayUnreachableError";
  }
}
