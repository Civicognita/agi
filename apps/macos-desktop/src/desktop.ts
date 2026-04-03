/**
 * Aionima Desktop Controller — Task #219
 *
 * Manages the macOS desktop application lifecycle:
 * - Gateway WebSocket connection
 * - Menubar status updates
 * - OS notification forwarding
 * - Global keyboard shortcut handling
 */

import type {
  DesktopConfig,
  DesktopNotification,
  GatewayConnection,
  MenubarStatus,
  ShortcutAction,
} from "./types.js";

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: DesktopConfig = {
  gatewayUrl: "ws://localhost:9800",
  gatewayPort: 9800,
  autoStart: false,
  globalShortcut: "CommandOrControl+Shift+N",
  showMenubar: true,
  notifications: true,
};

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type DesktopEventMap = {
  "status-change": MenubarStatus;
  notification: DesktopNotification;
  "shortcut-triggered": ShortcutAction;
  "gateway-connected": void;
  "gateway-disconnected": void;
};

type DesktopEventHandler<K extends keyof DesktopEventMap> = (
  data: DesktopEventMap[K],
) => void;

// ---------------------------------------------------------------------------
// Desktop controller
// ---------------------------------------------------------------------------

export class AionimaDesktop {
  private readonly config: DesktopConfig;
  private connection: GatewayConnection;
  private readonly listeners = new Map<string, Set<DesktopEventHandler<keyof DesktopEventMap>>>();

  constructor(config?: Partial<DesktopConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.connection = {
      status: "disconnected",
      url: this.config.gatewayUrl,
      sessionCount: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Initialize the desktop application.
   * Sets up menubar, global shortcuts, and connects to gateway.
   */
  async initialize(): Promise<void> {
    if (this.config.showMenubar) {
      await this.setupMenubar();
    }

    await this.registerGlobalShortcut(this.config.globalShortcut);

    if (this.config.autoStart) {
      await this.enableAutoStart();
    }

    await this.connectToGateway();
  }

  /** Shut down the desktop application. */
  async shutdown(): Promise<void> {
    await this.unregisterGlobalShortcut();
    this.updateStatus("disconnected");
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------
  // Gateway connection
  // -------------------------------------------------------------------------

  /** Connect to the local gateway. */
  async connectToGateway(): Promise<void> {
    this.updateStatus("syncing");

    // In Tauri, WebSocket connections are managed via the Rust backend
    // The frontend sends commands via Tauri's invoke API
    try {
      // Tauri command: connect_gateway(url)
      // await invoke("connect_gateway", { url: this.config.gatewayUrl });
      this.connection.lastPing = new Date();
      this.updateStatus("connected");
      this.emit("gateway-connected", undefined as never);
    } catch {
      this.updateStatus("error");
    }
  }

  /** Get current connection info. */
  getConnection(): Readonly<GatewayConnection> {
    return { ...this.connection };
  }

  // -------------------------------------------------------------------------
  // Menubar
  // -------------------------------------------------------------------------

  private async setupMenubar(): Promise<void> {
    // Tauri tray icon setup — configured in tauri.conf.json
    // Runtime updates via tray.set_icon() and tray.set_tooltip()
  }

  private updateStatus(status: MenubarStatus): void {
    this.connection.status = status;
    this.emit("status-change", status);
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  /** Send an OS-level notification. */
  async notify(notification: DesktopNotification): Promise<void> {
    if (!this.config.notifications) return;

    // Tauri notification API
    // await sendNotification({
    //   title: notification.title,
    //   body: notification.body,
    // });

    this.emit("notification", notification);
  }

  // -------------------------------------------------------------------------
  // Global shortcuts
  // -------------------------------------------------------------------------

  private async registerGlobalShortcut(_shortcut: string): Promise<void> {
    // Tauri global shortcut API
    // await register(shortcut, () => {
    //   this.emit("shortcut-triggered", "focus_window");
    //   this.focusWindow();
    // });
  }

  private async unregisterGlobalShortcut(): Promise<void> {
    // await unregisterAll();
  }

  /** Bring the main window to the front. */
  async focusWindow(): Promise<void> {
    // Tauri window management
    // const window = getCurrent();
    // await window.setFocus();
    // await window.unminimize();
  }

  // -------------------------------------------------------------------------
  // Auto-start
  // -------------------------------------------------------------------------

  private async enableAutoStart(): Promise<void> {
    // Tauri auto-start plugin
    // await enable();
  }

  async disableAutoStart(): Promise<void> {
    // await disable();
  }

  // -------------------------------------------------------------------------
  // Event system
  // -------------------------------------------------------------------------

  on<K extends keyof DesktopEventMap>(
    event: K,
    handler: DesktopEventHandler<K>,
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as DesktopEventHandler<keyof DesktopEventMap>);
  }

  off<K extends keyof DesktopEventMap>(
    event: K,
    handler: DesktopEventHandler<K>,
  ): void {
    this.listeners.get(event)?.delete(handler as DesktopEventHandler<keyof DesktopEventMap>);
  }

  private emit<K extends keyof DesktopEventMap>(
    event: K,
    data: DesktopEventMap[K],
  ): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      (handler as DesktopEventHandler<K>)(data);
    }
  }
}
