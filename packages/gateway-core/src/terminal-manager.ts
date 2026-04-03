/**
 * TerminalManager — manages real PTY shell sessions per project.
 *
 * Uses node-pty for proper pseudo-terminal allocation, giving full
 * interactive bash with prompt, line editing, tab completion, colors,
 * and correct resize handling (SIGWINCH).
 */

import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerminalSession {
  id: string;
  projectPath: string;
  pty: IPty;
  cols: number;
  rows: number;
}

export interface TerminalManagerEvents {
  data: (sessionId: string, data: string) => void;
  exit: (sessionId: string, code: number | null) => void;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class TerminalManager extends EventEmitter {
  private readonly sessions = new Map<string, TerminalSession>();

  override on<K extends keyof TerminalManagerEvents>(
    event: K,
    listener: TerminalManagerEvents[K],
  ): this {
    return super.on(event, listener);
  }

  override emit<K extends keyof TerminalManagerEvents>(
    event: K,
    ...args: Parameters<TerminalManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Open a new terminal session in the given project directory.
   * Returns the session or null if the directory doesn't exist.
   */
  open(id: string, projectPath: string, cols = 80, rows = 24): TerminalSession | null {
    if (!existsSync(projectPath)) return null;

    // Close existing session with same id
    if (this.sessions.has(id)) {
      this.close(id);
    }

    const shell = process.env.SHELL ?? "bash";

    const ptyProcess = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: projectPath,
      env: process.env as Record<string, string>,
    });

    const session: TerminalSession = { id, projectPath, pty: ptyProcess, cols, rows };
    this.sessions.set(id, session);

    ptyProcess.onData((data: string) => {
      this.emit("data", id, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.emit("exit", id, exitCode);
    });

    return session;
  }

  /**
   * Open a terminal session inside a running container via `podman exec`.
   * Returns the session or null if the container is not accessible.
   */
  openInContainer(id: string, containerName: string, cols = 80, rows = 24): TerminalSession | null {
    // Close existing session with same id
    if (this.sessions.has(id)) {
      this.close(id);
    }

    const ptyProcess = pty.spawn("podman", ["exec", "-it", containerName, "/bin/sh"], {
      name: "xterm-256color",
      cols,
      rows,
      env: process.env as Record<string, string>,
    });

    const session: TerminalSession = { id, projectPath: `container:${containerName}`, pty: ptyProcess, cols, rows };
    this.sessions.set(id, session);

    ptyProcess.onData((data: string) => {
      this.emit("data", id, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.emit("exit", id, exitCode);
    });

    return session;
  }

  /** Write data to the session's PTY. */
  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.write(data);
    }
  }

  /** Resize the terminal PTY (sends SIGWINCH to the process). */
  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.cols = cols;
    session.rows = rows;
    session.pty.resize(cols, rows);
  }

  /** Close a specific session. */
  close(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    try {
      session.pty.kill();
    } catch { /* already dead */ }
    this.sessions.delete(id);
  }

  /** Close all sessions (for shutdown). */
  closeAll(): void {
    for (const id of Array.from(this.sessions.keys())) {
      this.close(id);
    }
  }

  /** Check if a session exists. */
  has(id: string): boolean {
    return this.sessions.has(id);
  }
}
