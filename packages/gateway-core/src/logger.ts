/**
 * Structured file logger with rotation.
 *
 * Writes to two log files:
 *   - activity.log — all events (debug, info, warn, error)
 *   - error.log — only warn + error level entries
 *
 * Rotation: size-based, configurable max file size and max rotated files.
 * Format: ISO 8601 timestamp, padded level, [component], message.
 */

import { createWriteStream, renameSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { WriteStream } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structured log entry emitted for each write. */
export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  component: string;
  message: string;
}

export interface LoggerConfig {
  /** Directory for log files. Default: "./logs" */
  logDir?: string;
  /** Max file size in bytes before rotation. Default: 10 MB */
  maxFileSize?: number;
  /** Max number of rotated files to keep. Default: 5 */
  maxFiles?: number;
  /** Minimum log level. Default: "info" */
  level?: "debug" | "info" | "warn" | "error";
  /** Also write to stdout. Default: true */
  stdout?: boolean;
}

export interface Logger {
  debug(component: string, message: string): void;
  info(component: string, message: string): void;
  warn(component: string, message: string): void;
  error(component: string, message: string): void;
  close(): void;
  /** Register a listener that receives every log entry after it is written. */
  onEntry(cb: (entry: LogEntry) => void): void;
}

export interface ComponentLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// ---------------------------------------------------------------------------
// Level utilities
// ---------------------------------------------------------------------------

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const LEVEL_LABELS: Record<Level, string> = {
  debug: "DEBUG",
  info:  "INFO ",
  warn:  "WARN ",
  error: "ERROR",
};

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

function getFileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function rotate(filePath: string, maxFiles: number): void {
  // Delete the oldest rotated file
  // Shift .4 → .5, .3 → .4, ..., .1 → .2, base → .1
  for (let i = maxFiles - 1; i >= 1; i--) {
    const from = i === 1 ? filePath : `${filePath}.${String(i - 1)}`;
    const to = `${filePath}.${String(i)}`;
    try {
      renameSync(from, to);
    } catch {
      // File may not exist yet — that's fine
    }
  }
  // Rename current → .1
  try {
    renameSync(filePath, `${filePath}.1`);
  } catch {
    // File may not exist yet
  }
}

// ---------------------------------------------------------------------------
// RotatingStream — manages a single log file with rotation
// ---------------------------------------------------------------------------

class RotatingStream {
  private stream: WriteStream;
  private currentSize: number;
  private readonly filePath: string;
  private readonly maxFileSize: number;
  private readonly maxFiles: number;

  constructor(filePath: string, maxFileSize: number, maxFiles: number) {
    this.filePath = filePath;
    this.maxFileSize = maxFileSize;
    this.maxFiles = maxFiles;
    this.currentSize = getFileSize(filePath);
    this.stream = createWriteStream(filePath, { flags: "a" });
  }

  write(line: string): void {
    const bytes = Buffer.byteLength(line);
    if (this.currentSize + bytes > this.maxFileSize) {
      this.stream.end();
      rotate(this.filePath, this.maxFiles);
      this.stream = createWriteStream(this.filePath, { flags: "a" });
      this.currentSize = 0;
    }
    this.stream.write(line);
    this.currentSize += bytes;
  }

  close(): void {
    this.stream.end();
  }
}

// ---------------------------------------------------------------------------
// createLogger
// ---------------------------------------------------------------------------

export function createLogger(config?: LoggerConfig): Logger {
  const rawLogDir = config?.logDir ?? join(homedir(), ".agi", "logs");
  const logDir = rawLogDir.replace(/^~/, homedir());
  const maxFileSize = config?.maxFileSize ?? 10_485_760;
  const maxFiles = config?.maxFiles ?? 5;
  const minLevel = LEVELS[config?.level ?? "info"];
  const stdout = config?.stdout ?? true;

  mkdirSync(logDir, { recursive: true });

  const activityPath = join(logDir, "activity.log");
  const errorPath = join(logDir, "error.log");

  const activityStream = new RotatingStream(activityPath, maxFileSize, maxFiles);
  const errorStream = new RotatingStream(errorPath, maxFileSize, maxFiles);

  let entryListener: ((entry: LogEntry) => void) | null = null;

  function write(level: Level, component: string, message: string): void {
    if (LEVELS[level] < minLevel) return;

    const timestamp = new Date().toISOString();
    const line = `${timestamp} [${LEVEL_LABELS[level]}] [${component}] ${message}\n`;

    activityStream.write(line);

    if (level === "warn" || level === "error") {
      errorStream.write(line);
    }

    if (stdout) {
      if (level === "error") {
        process.stderr.write(line);
      } else {
        process.stdout.write(line);
      }
    }

    if (entryListener !== null) {
      entryListener({ timestamp, level, component, message });
    }
  }

  return {
    debug: (component, message) => write("debug", component, message),
    info: (component, message) => write("info", component, message),
    warn: (component, message) => write("warn", component, message),
    error: (component, message) => write("error", component, message),
    close() {
      activityStream.close();
      errorStream.close();
    },
    onEntry(cb) {
      entryListener = cb;
    },
  };
}

// ---------------------------------------------------------------------------
// createComponentLogger
// ---------------------------------------------------------------------------

export function createComponentLogger(logger: Logger | undefined, component: string): ComponentLogger {
  if (logger === undefined) {
    // Fallback to console for tests / no-logger scenarios
    return {
      debug: (msg) => console.log(`[${component}] ${msg}`),
      info: (msg) => console.log(`[${component}] ${msg}`),
      warn: (msg) => console.warn(`[${component}] ${msg}`),
      error: (msg) => console.error(`[${component}] ${msg}`),
    };
  }
  return {
    debug: (msg) => logger.debug(component, msg),
    info: (msg) => logger.info(component, msg),
    warn: (msg) => logger.warn(component, msg),
    error: (msg) => logger.error(component, msg),
  };
}
