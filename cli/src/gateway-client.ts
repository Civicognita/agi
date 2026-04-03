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
