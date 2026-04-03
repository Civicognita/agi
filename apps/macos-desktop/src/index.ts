/**
 * Aionima Desktop — macOS Tauri Wrapper (Task #219)
 *
 * Wraps the WebChat UI in a native macOS application via Tauri.
 * Features:
 *   - Menubar icon showing active session status
 *   - OS-level notifications from connected channels
 *   - Global keyboard shortcut to focus app
 *   - Auto-start on login
 *   - Serves WebChat from local gateway (not cloud URL)
 */

export type { DesktopConfig, MenubarStatus, ShortcutAction } from "./types.js";
export { AionimaDesktop } from "./desktop.js";
