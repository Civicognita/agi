/**
 * Dashboard Real-time Events — Task #153
 *
 * Broadcasts dashboard events over the existing GatewayWebSocketServer.
 * Dashboard clients subscribe via "dashboard:subscribe" message.
 * Events are filtered by entity ID and channel if specified.
 */

import type { EventEmitter } from "node:events";

import type {
  ActivityEntry,
  TmJobUpdateData,
  COAExplorerEntry,
  ContainerStatusChangedData,
  DashboardEvent,
  DashboardOverview,
  DashboardSubscription,
  NotificationData,
  ProjectActivityData,
  ProjectConfigChangedData,
  SystemUpgradeData,
  HostingStatusData,
  UpdateCheckData,
} from "./dashboard-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardEventsDeps {
  /** The WebSocket server to broadcast through. */
  wss: DashboardBroadcaster;
}

/** Minimal broadcaster interface (matches GatewayWebSocketServer). */
export interface DashboardBroadcaster {
  broadcast(event: string, data: unknown): void;
  on(event: string, listener: (...args: unknown[]) => void): EventEmitter;
}

/** Subscriber filter state. */
interface DashboardSubscriber {
  connectionId: string;
  channels: Set<string> | null;
  entityIds: Set<string> | null;
}

// ---------------------------------------------------------------------------
// DashboardEventBroadcaster
// ---------------------------------------------------------------------------

export class DashboardEventBroadcaster {
  private readonly wss: DashboardBroadcaster;
  private readonly subscribers = new Map<string, DashboardSubscriber>();

  /** Debounced overview broadcast — avoid flooding on high-throughput. */
  private overviewTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingOverview: DashboardOverview | null = null;

  /** Overview broadcast debounce interval in milliseconds. */
  readonly overviewDebounceMs: number;

  constructor(deps: DashboardEventsDeps, overviewDebounceMs = 2000) {
    this.wss = deps.wss;
    this.overviewDebounceMs = overviewDebounceMs;

    // Listen for subscription messages
    this.wss.on("message", (connectionId: unknown, message: unknown) => {
      if (typeof connectionId !== "string") return;
      if (typeof message !== "object" || message === null) return;
      const msg = message as Record<string, unknown>;
      if (msg["type"] === "dashboard:subscribe") {
        this.handleSubscribe(connectionId, msg as unknown as DashboardSubscription);
      }
      if (msg["type"] === "dashboard:unsubscribe") {
        this.subscribers.delete(connectionId);
      }
    });

    // Clean up on disconnect
    this.wss.on("disconnection", (connectionId: unknown) => {
      if (typeof connectionId === "string") {
        this.subscribers.delete(connectionId);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Subscription management
  // ---------------------------------------------------------------------------

  private handleSubscribe(connectionId: string, sub: DashboardSubscription): void {
    const channels = sub.channels !== undefined && sub.channels.length > 0
      ? new Set(sub.channels)
      : null;
    const entityIds = sub.entityIds !== undefined && sub.entityIds.length > 0
      ? new Set(sub.entityIds)
      : null;

    this.subscribers.set(connectionId, {
      connectionId,
      channels,
      entityIds,
    });
  }

  /** Get the number of active dashboard subscribers. */
  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  // ---------------------------------------------------------------------------
  // Event emission
  // ---------------------------------------------------------------------------

  /** Emit an impact:recorded event. */
  emitImpactRecorded(entry: ActivityEntry): void {
    this.broadcastToSubscribers({
      type: "impact:recorded",
      data: entry,
    });
  }

  /** Emit an entity:verified event. */
  emitEntityVerified(entityId: string, tier: string): void {
    this.broadcastToSubscribers({
      type: "entity:verified",
      data: { entityId, tier },
    });
  }

  /** Emit a coa:created event. */
  emitCOACreated(entry: COAExplorerEntry): void {
    this.broadcastToSubscribers({
      type: "coa:created",
      data: entry,
    });
  }

  /** Emit a project:activity event. */
  emitProjectActivity(data: ProjectActivityData): void {
    this.broadcastToSubscribers({
      type: "project:activity",
      data: {
        ...data,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /** Emit a system:upgrade event (broadcast to all subscribers). */
  emitSystemUpgrade(data: SystemUpgradeData): void {
    this.broadcastToSubscribers({
      type: "system:upgrade",
      data,
    });
  }

  /** Emit a hosting:status event (broadcast to all subscribers). */
  emitHostingStatus(data: HostingStatusData): void {
    this.broadcastToSubscribers({
      type: "hosting:status",
      data,
    });
  }

  /** Emit a tm:job_update event. */
  emitTmJobUpdate(data: TmJobUpdateData): void {
    this.broadcastToSubscribers({
      type: "tm:job_update",
      data,
    });
  }

  /** Emit a notification:new event (real-time push). */
  emitNotification(data: NotificationData): void {
    this.broadcastToSubscribers({
      type: "notification:new",
      data,
    });
  }

  /** Emit a system:update_available event (broadcast to all subscribers). */
  emitUpdateAvailable(data: UpdateCheckData): void {
    this.broadcastToSubscribers({
      type: "system:update_available",
      data,
    });
  }

  /** Emit a project:config_changed event when project.json is modified. */
  emitProjectConfigChanged(data: ProjectConfigChangedData): void {
    this.broadcastToSubscribers({
      type: "project:config_changed",
      data,
    });
  }

  /** Emit a project:container_status event for per-project status changes. */
  emitContainerStatusChanged(data: ContainerStatusChangedData): void {
    this.broadcastToSubscribers({
      type: "project:container_status",
      data,
    });
  }

  /**
   * Emit an overview:updated event (debounced).
   * Multiple rapid calls collapse into one broadcast.
   */
  emitOverviewUpdated(overview: DashboardOverview): void {
    this.pendingOverview = overview;

    if (this.overviewTimer !== null) return;

    this.overviewTimer = setTimeout(() => {
      this.overviewTimer = null;
      if (this.pendingOverview !== null) {
        this.broadcastToSubscribers({
          type: "overview:updated",
          data: this.pendingOverview,
        });
        this.pendingOverview = null;
      }
    }, this.overviewDebounceMs);
  }

  // ---------------------------------------------------------------------------
  // Filtered broadcast
  // ---------------------------------------------------------------------------

  private broadcastToSubscribers(event: DashboardEvent): void {
    if (this.subscribers.size === 0) {
      // No subscribers — skip serialization
      return;
    }

    // For unfiltered broadcast (no subscribers have filters), use wss.broadcast
    let allUnfiltered = true;
    for (const sub of this.subscribers.values()) {
      if (sub.channels !== null || sub.entityIds !== null) {
        allUnfiltered = false;
        break;
      }
    }

    if (allUnfiltered) {
      this.wss.broadcast("dashboard_event", event);
      return;
    }

    // Filter per subscriber
    const eventEntityId = extractEntityId(event);
    const eventChannel = extractChannel(event);

    for (const sub of this.subscribers.values()) {
      if (sub.entityIds !== null && eventEntityId !== null) {
        if (!sub.entityIds.has(eventEntityId)) continue;
      }
      if (sub.channels !== null && eventChannel !== null) {
        if (!sub.channels.has(eventChannel)) continue;
      }
      // Match — broadcast to all (can't target individual connections via wss.broadcast)
      // For now, use full broadcast. Per-connection filtering would require
      // socket-level send, which we'd need the WS server to expose.
      this.wss.broadcast("dashboard_event", event);
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy(): void {
    if (this.overviewTimer !== null) {
      clearTimeout(this.overviewTimer);
      this.overviewTimer = null;
    }
    this.subscribers.clear();
    this.pendingOverview = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractEntityId(event: DashboardEvent): string | null {
  switch (event.type) {
    case "impact:recorded":
      return event.data.entityId;
    case "entity:verified":
      return event.data.entityId;
    case "coa:created":
      return event.data.entityId;
    case "overview:updated":
    case "project:activity":
    case "system:upgrade":
    case "system:update_available":
    case "hosting:status":
    case "project:config_changed":
    case "project:container_status":
    case "tm:job_update":
    case "worker:done":
    case "tm:phase_done":
    case "tm:checkpoint":
    case "tm:report_ready":
    case "tm:job_failed":
    case "notification:new":
      return null;
  }
}

function extractChannel(event: DashboardEvent): string | null {
  switch (event.type) {
    case "impact:recorded":
      return event.data.channel;
    case "coa:created":
    case "project:activity":
    case "system:upgrade":
    case "system:update_available":
    case "hosting:status":
    case "project:config_changed":
    case "project:container_status":
    case "tm:job_update":
    case "notification:new":
      return null;
    default:
      return null;
  }
}
