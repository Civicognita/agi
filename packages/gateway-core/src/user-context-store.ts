/**
 * UserContextStore — per-entity relationship context (USER.md files).
 *
 * Loads and saves markdown context files for each entity, which are
 * injected into the system prompt as "Entity Relationship Context".
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export class UserContextStore {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /** Load user context for an entity. Returns undefined if no file exists. */
  load(entityId: string): string | undefined {
    try {
      return readFileSync(this.getUserPath(entityId), "utf-8").trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /** Save/update user context for an entity. Creates directories if needed. */
  save(entityId: string, content: string): void {
    const filePath = this.getUserPath(entityId);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
  }

  private getUserPath(entityId: string): string {
    return join(this.baseDir, "users", `${entityId}.md`);
  }
}
