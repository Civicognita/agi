/**
 * ChannelEventDispatcher — channel-event → bound-project resolver.
 *
 * **CHN-C (s164) slice 2 — 2026-05-14.** The dispatcher primitive that
 * wraps `ProjectConfigManager.findProjectByRoom()` with workspace
 * iteration. Channel adapters (Discord today; Telegram/Slack/etc. as
 * CHN-I/J/K/L migrate) call `dispatch(channelId, roomId)` to learn
 * which project the inbound event belongs to.
 *
 * Read-only at this slice: lookups walk the configured
 * `workspace.projects[]` sub-directories on every call. Caching +
 * cache-invalidation on POST/DELETE /api/projects/rooms lands in a
 * follow-up slice once dispatch latency becomes measurable.
 *
 * Does NOT yet wire into the inbound message-router pipeline — the
 * legacy AionimaMessage shape doesn't carry an explicit `roomId`, so
 * the wire-up happens when channels migrate to the new ChannelEvent
 * shape (CHN-B slice 2+). For now this class is a primitive other
 * surfaces (CHN-B dispatch, CHN-E pending-entity resolver, CHN-F
 * role→workflow binding) call directly.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolve as resolvePath } from "node:path";
import type { ProjectConfigManager } from "./project-config-manager.js";
import type { ProjectRoomBinding } from "@agi/config";

export interface ChannelEventDispatcherDeps {
  /** Resolved project config manager (with findProjectByRoom). */
  projectConfigManager: ProjectConfigManager;
  /**
   * Workspace roots from `config.workspace.projects[]`. The dispatcher
   * walks one level of sub-directories under each root to enumerate
   * candidate project paths.
   */
  workspaceProjects: string[];
}

export interface DispatchResult {
  /** Resolved project path that binds (channelId, roomId). */
  projectPath: string;
  /** The matching binding record. */
  binding: ProjectRoomBinding;
}

export class ChannelEventDispatcher {
  private readonly mgr: ProjectConfigManager;
  private readonly workspaceProjects: readonly string[];

  constructor(deps: ChannelEventDispatcherDeps) {
    this.mgr = deps.projectConfigManager;
    this.workspaceProjects = [...deps.workspaceProjects];
  }

  /**
   * Resolve an inbound channel event to its bound project, if any.
   * Returns null when no project binds this (channelId, roomId) pair.
   *
   * Performance: O(W * P * R) per call (W workspace roots × P projects
   * per root × R bindings per project). Realistic workloads (W<5, P<50,
   * R<20) make this sub-millisecond. Cache layer lands when measured.
   */
  dispatch(channelId: string, roomId: string): DispatchResult | null {
    const candidates = this.enumerateProjectCandidates();
    return this.mgr.findProjectByRoom(channelId, roomId, candidates);
  }

  /**
   * Enumerate immediate sub-directories of each workspace root as
   * project candidates. Returns absolute paths. Skips entries that
   * don't exist on disk or aren't directories (filesystem-race
   * tolerant).
   */
  private enumerateProjectCandidates(): string[] {
    const out: string[] = [];
    for (const root of this.workspaceProjects) {
      const resolved = resolvePath(root);
      if (!existsSync(resolved)) continue;
      let entries: string[];
      try {
        entries = readdirSync(resolved);
      } catch {
        continue;
      }
      for (const name of entries) {
        // Skip hidden + meta dirs (.git, .agi, etc.) and common cache dirs
        if (name.startsWith(".")) continue;
        if (name === "node_modules") continue;
        const fullPath = join(resolved, name);
        try {
          if (!statSync(fullPath).isDirectory()) continue;
        } catch {
          continue;
        }
        out.push(fullPath);
      }
    }
    return out;
  }
}
