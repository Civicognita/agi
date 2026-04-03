/**
 * macOS Desktop Types — Task #219
 */

/** Desktop app configuration. */
export interface DesktopConfig {
  /** Local gateway URL (serves WebChat). */
  gatewayUrl: string;
  /** Port for the local gateway. */
  gatewayPort: number;
  /** Whether to auto-start on login. */
  autoStart: boolean;
  /** Global keyboard shortcut to focus the app. */
  globalShortcut: string;
  /** Whether to show menubar icon. */
  showMenubar: boolean;
  /** Whether to enable OS notifications. */
  notifications: boolean;
}

/** Menubar icon status states. */
export type MenubarStatus =
  | "connected"
  | "disconnected"
  | "syncing"
  | "error";

/** Global shortcut actions. */
export type ShortcutAction =
  | "focus_window"
  | "toggle_visibility"
  | "quick_input";

/** OS notification payload. */
export interface DesktopNotification {
  title: string;
  body: string;
  channel?: string;
  entityId?: string;
  /** Deep link to open when notification is clicked. */
  actionUrl?: string;
}

/** Gateway connection state. */
export interface GatewayConnection {
  status: MenubarStatus;
  url: string;
  lastPing?: Date;
  sessionCount: number;
}
