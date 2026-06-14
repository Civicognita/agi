/**
 * agi-repo-manager — {project}.agi monorepo envelope (Phase 3, first slice).
 *
 * Formalizes a project folder as a git repository under the hard `{slug}.agi`
 * naming convention. The `.agi` suffix distinguishes the project *envelope*
 * from the actual repos it contains. Each entry under `repos/` that is itself
 * a git repo is registered as a git **submodule** of the envelope; the
 * envelope tracks `project.json`, `k/`, and `.gitmodules` directly while
 * ignoring scratch (`sandbox/`, `.trash/`).
 *
 * Owner-confirmed mechanics only. Deferred (NOT here): the Tynn-desktop
 * discovery handshake + shared schema convergence, `{slug}.agi` GitHub remote
 * auto-creation, and automatic submodule-pin advancement on upgrade.
 *
 * The `_aionima` meta-project is EXCLUDED — it keeps its `collection.json`
 * convention and is not a `{slug}.agi` project.
 *
 * All git invocations go through spawnSync with array args (no shell), so a
 * malicious path or URL cannot inject a command.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { KNOWLEDGE_DIR } from "./project-config-path.js";

const GIT_TIMEOUT_MS = 30_000;

// Committer identity for envelope commits — the gateway acts on the owner's
// behalf. Passed per-commit so a missing global git config never blocks init.
const COMMIT_ENV = [
  "-c",
  "user.name=Aionima",
  "-c",
  "user.email=aion@aionima.local",
];

export interface AgiRepoStatus {
  /** True when the envelope folder is a git repo. */
  initialized: boolean;
  /** Submodule paths registered in `.gitmodules` (e.g. ["repos/agi"]). */
  submodules: string[];
  /** Subdirs under `repos/` that are git repos but NOT yet registered as
   *  submodules — candidates for import. */
  unregisteredRepos: string[];
}

export interface AgiRepoOpResult {
  ok: boolean;
  initialized?: boolean;
  registered?: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// git helper
// ---------------------------------------------------------------------------

function git(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync("git", args, { cwd, encoding: "utf-8", timeout: GIT_TIMEOUT_MS });
  return {
    ok: res.status === 0,
    stdout: (res.stdout ?? "").trim(),
    stderr: (res.stderr ?? res.error?.message ?? "").trim(),
  };
}

function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

/** A project is the `_aionima` meta-project — excluded from the .agi model. */
function isExcludedEnvelope(projectPath: string): boolean {
  return basename(projectPath) === "_aionima";
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Subdirs of `<projectPath>/repos/` that are themselves git repos.
 *  Defensive: an unreadable `repos/` degrades to [] rather than throwing. */
function detectRepoGitDirs(projectPath: string): string[] {
  const reposDir = join(projectPath, "repos");
  if (!existsSync(reposDir)) return [];
  try {
    const out: string[] = [];
    for (const entry of readdirSync(reposDir, { withFileTypes: true })) {
      if (entry.isDirectory() && isGitRepo(join(reposDir, entry.name))) {
        out.push(entry.name);
      }
    }
    return out.sort();
  } catch {
    return [];
  }
}

/** Submodule paths listed in `<projectPath>/.gitmodules`.
 *  Defensive: a malformed/unreadable `.gitmodules` (e.g. it's a directory)
 *  degrades to [] rather than throwing — the envelope is still "initialized". */
function readSubmodulePaths(projectPath: string): string[] {
  const modulesFile = join(projectPath, ".gitmodules");
  if (!existsSync(modulesFile)) return [];
  try {
    const text = readFileSync(modulesFile, "utf-8");
    const paths: string[] = [];
    for (const line of text.split("\n")) {
      const m = /^\s*path\s*=\s*(.+?)\s*$/.exec(line);
      if (m?.[1]) paths.push(m[1]);
    }
    return paths.sort();
  } catch {
    return [];
  }
}

export function getAgiRepoStatus(projectPath: string): AgiRepoStatus {
  // Defensive: this feeds a GET endpoint the dashboard auto-fires on load, so a
  // throw here surfaces as a 500 (story #207 — observed on envelopes with an
  // unreadable repos/ or a malformed .gitmodules). Any failure degrades to the
  // "not initialized" shape rather than erroring the whole panel.
  try {
    const initialized = isGitRepo(projectPath);
    const submodules = initialized ? readSubmodulePaths(projectPath) : [];
    const registered = new Set(submodules.map((p) => p.replace(/^repos\//, "")));
    const unregisteredRepos = detectRepoGitDirs(projectPath).filter((name) => !registered.has(name));
    return { initialized, submodules, unregisteredRepos };
  } catch {
    return { initialized: false, submodules: [], unregisteredRepos: [] };
  }
}

// ---------------------------------------------------------------------------
// Init — make the envelope a git repo
// ---------------------------------------------------------------------------

/**
 * `git init` the project envelope, write a `.gitignore` that excludes scratch
 * (`sandbox/`, `.trash/`), and commit the skeleton (`project.json`, `k/`).
 * Idempotent: a no-op when the envelope is already a git repo.
 */
export function initAgiRepo(projectPath: string): AgiRepoOpResult {
  if (isExcludedEnvelope(projectPath)) {
    return { ok: false, error: "_aionima is a collection, not a {slug}.agi project" };
  }
  if (!existsSync(projectPath)) {
    return { ok: false, error: `project path does not exist: ${projectPath}` };
  }
  if (isGitRepo(projectPath)) {
    return { ok: true, initialized: true };
  }

  const init = git(["init"], projectPath);
  if (!init.ok) return { ok: false, error: `git init failed: ${init.stderr}` };

  // Scratch + soft-delete are envelope-local, never committed. Chats AND memory
  // are local runtime state too — `.ai/chat/` + `.ai/memory/` are excluded so
  // they never travel through the envelope's config/knowledge sync (story #207,
  // owner directive; memory-exclude pending Genie confirmation on #178).
  const gitignore = join(projectPath, ".gitignore");
  if (!existsSync(gitignore)) {
    writeFileSync(
      gitignore,
      ["sandbox/", ".trash/", `${KNOWLEDGE_DIR}/chat/`, `${KNOWLEDGE_DIR}/memory/`, "node_modules/", ""].join("\n"),
      "utf-8",
    );
  }

  // Stage envelope-owned content only (project.json, .ai/, .gitignore). repos/
  // entries become submodules separately, not regular tracked content.
  for (const rel of ["project.json", KNOWLEDGE_DIR, ".gitignore"]) {
    if (existsSync(join(projectPath, rel))) git(["add", "--", rel], projectPath);
  }

  const commit = git([...COMMIT_ENV, "commit", "-m", "Initialize .agi envelope"], projectPath);
  // An empty skeleton with nothing staged yields "nothing to commit" — still a
  // successfully-initialized repo, so don't treat that as failure.
  if (!commit.ok && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
    return { ok: false, error: `initial commit failed: ${commit.stderr}` };
  }

  return { ok: true, initialized: true };
}

// ---------------------------------------------------------------------------
// Submodule registration
// ---------------------------------------------------------------------------

/**
 * Register `repos/<name>` as a git submodule pointing at `url`. Used when a new
 * repo is added to the project. Requires the envelope to be initialized.
 */
export function addRepoSubmodule(
  projectPath: string,
  name: string,
  url: string,
  branch?: string,
): AgiRepoOpResult {
  if (!isGitRepo(projectPath)) {
    return { ok: false, error: "envelope is not a .agi repo — initialize it first" };
  }
  const relPath = `repos/${name}`;
  const args = ["submodule", "add"];
  if (branch) args.push("-b", branch);
  args.push("--", url, relPath);

  const add = git(args, projectPath);
  if (!add.ok) {
    return { ok: false, error: `git submodule add failed: ${add.stderr}` };
  }
  git([...COMMIT_ENV, "commit", "-m", `Add submodule ${relPath}`], projectPath);
  return { ok: true, registered: [relPath] };
}

// ---------------------------------------------------------------------------
// Import — adopt an existing folder as a .agi envelope
// ---------------------------------------------------------------------------

/**
 * Adopt an existing project folder as a `{slug}.agi` envelope: initialize the
 * envelope if needed, then register every git repo already present under
 * `repos/` as a submodule (deriving the remote from its `origin`). Returns the
 * list of newly-registered submodule paths.
 */
export function importAgiRepo(projectPath: string): AgiRepoOpResult {
  if (isExcludedEnvelope(projectPath)) {
    return { ok: false, error: "_aionima is a collection, not a {slug}.agi project" };
  }

  if (!isGitRepo(projectPath)) {
    const init = initAgiRepo(projectPath);
    if (!init.ok) return init;
  }

  const already = new Set(readSubmodulePaths(projectPath).map((p) => p.replace(/^repos\//, "")));
  const registered: string[] = [];

  for (const name of detectRepoGitDirs(projectPath)) {
    if (already.has(name)) continue;
    const reposChild = join(projectPath, "repos", name);
    const originRes = git(["remote", "get-url", "origin"], reposChild);
    if (!originRes.ok || !originRes.stdout) {
      // No origin to point the submodule at — skip rather than fabricate one.
      continue;
    }
    const add = git(["submodule", "add", "--", originRes.stdout, `repos/${name}`], projectPath);
    if (add.ok) {
      registered.push(`repos/${name}`);
    }
  }

  if (registered.length > 0) {
    git([...COMMIT_ENV, "commit", "-m", `Import ${String(registered.length)} repo(s) as submodules`], projectPath);
  }

  return { ok: true, initialized: true, registered };
}

// ---------------------------------------------------------------------------
// Slice 1 (story #207) — config/knowledge STATE sync. The envelope's git
// identity is its config + knowledge state + submodule pins, NOT a working
// tree of source. Chats (`.ai/chat/`), sandbox and .trash never sync.
// ---------------------------------------------------------------------------

/** The canonical `{slug}.agi` remote repo name for an envelope folder. */
export function agiRemoteName(projectPath: string): string {
  const base = basename(projectPath);
  return base.endsWith(".agi") ? base : `${base}.agi`;
}

/** Classify a changed path within the envelope for the state diff. */
export type EnvelopeChangeKind = "config" | "knowledge" | "submodule" | "excluded";
export function classifyEnvelopePath(relPath: string): EnvelopeChangeKind {
  const p = relPath.replace(/^\.\//, "");
  // Local-only runtime state — never part of config/knowledge sync. Chats AND
  // memory are per-node runtime state (owner directive 2026-06-10, pending Genie
  // confirmation on #178); sandbox/.trash are scratch.
  if (p === "sandbox" || p.startsWith("sandbox/")) return "excluded";
  if (p === ".trash" || p.startsWith(".trash/")) return "excluded";
  if (p.startsWith(`${KNOWLEDGE_DIR}/chat/`)) return "excluded";
  if (p.startsWith(`${KNOWLEDGE_DIR}/memory/`)) return "excluded";
  // Shared config.
  if (p === "project.json" || p === ".gitmodules" || p === ".gitignore") return "config";
  // Submodule pins (a repos/<name> entry moves as a gitlink).
  if (p === "repos" || p.startsWith("repos/")) return "submodule";
  // Everything else under the knowledge dir is shared knowledge state.
  if (p === KNOWLEDGE_DIR || p.startsWith(`${KNOWLEDGE_DIR}/`)) return "knowledge";
  return "config"; // top-level envelope-owned file — treat as config.
}

export interface AgiConfigChange {
  path: string;
  kind: EnvelopeChangeKind;
  /** Change relative to upstream: added / modified / deleted. */
  change: "added" | "modified" | "deleted";
}

export interface AgiConfigState {
  initialized: boolean;
  /** True when an `origin` remote is configured. */
  hasRemote: boolean;
  remoteUrl: string | null;
  /** Commits the local envelope is ahead of / behind its upstream. */
  ahead: number;
  behind: number;
  /** Incoming (upstream) changes to review, classified, chats excluded. */
  incoming: AgiConfigChange[];
  /** Local uncommitted config/knowledge changes (chats excluded). */
  localChanges: AgiConfigChange[];
  /** Submodule paths whose pin differs from the checked-out commit. */
  submoduleDrift: string[];
}

/** Parse `git diff --name-status` output into classified changes (chats excluded). */
function parseNameStatus(raw: string): AgiConfigChange[] {
  const out: AgiConfigChange[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0]?.[0] ?? "";
    const path = parts[parts.length - 1] ?? "";
    if (!path) continue;
    const kind = classifyEnvelopePath(path);
    if (kind === "excluded") continue;
    const change = code === "A" ? "added" : code === "D" ? "deleted" : "modified";
    out.push({ path, kind, change });
  }
  return out;
}

/**
 * Inspect the envelope's config/knowledge state vs its upstream. Best-effort
 * `git fetch` first; degrades gracefully (no remote → ahead/behind 0). Never
 * throws — feeds a GET the dashboard auto-fires.
 */
export function getAgiConfigState(projectPath: string): AgiConfigState {
  const base: AgiConfigState = {
    initialized: false, hasRemote: false, remoteUrl: null,
    ahead: 0, behind: 0, incoming: [], localChanges: [], submoduleDrift: [],
  };
  try {
    if (!isGitRepo(projectPath)) return base;
    base.initialized = true;

    const origin = git(["remote", "get-url", "origin"], projectPath);
    base.hasRemote = origin.ok && origin.stdout.length > 0;
    base.remoteUrl = base.hasRemote ? origin.stdout : null;

    // Local uncommitted config/knowledge changes (chats excluded by classify).
    const localStatus = git(["status", "--porcelain", "--", ".", `:(exclude)${KNOWLEDGE_DIR}/chat`, `:(exclude)${KNOWLEDGE_DIR}/memory`], projectPath);
    if (localStatus.ok) {
      for (const line of localStatus.stdout.split("\n")) {
        if (!line.trim()) continue;
        const path = line.slice(3).trim();
        const kind = classifyEnvelopePath(path);
        if (kind === "excluded") continue;
        const x = line[0];
        const change = x === "A" || x === "?" ? "added" : x === "D" ? "deleted" : "modified";
        base.localChanges.push({ path, kind, change });
      }
    }

    if (!base.hasRemote) return base;

    // Best-effort fetch; never fatal (offline / no creds).
    git(["fetch", "--quiet", "origin"], projectPath);

    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], projectPath);
    const branchName = branch.ok && branch.stdout ? branch.stdout : "HEAD";
    const upstream = `origin/${branchName}`;

    const counts = git(["rev-list", "--left-right", "--count", `${upstream}...HEAD`], projectPath);
    if (counts.ok) {
      const [behind, ahead] = counts.stdout.split(/\s+/).map((n) => parseInt(n, 10) || 0);
      base.behind = behind ?? 0;
      base.ahead = ahead ?? 0;
    }

    if (base.behind > 0) {
      const diff = git(["diff", "--name-status", `HEAD...${upstream}`], projectPath);
      if (diff.ok) base.incoming = parseNameStatus(diff.stdout);
    }

    return base;
  } catch {
    return base;
  }
}

export interface AgiSyncResult {
  ok: boolean;
  error?: string;
  /** Human-readable summary line. */
  summary?: string;
}

/** Configure the envelope's `origin` remote (add or update). Injection-safe. */
export function setAgiRemote(projectPath: string, url: string): AgiSyncResult {
  if (!isGitRepo(projectPath)) {
    return { ok: false, error: "envelope is not a .agi repo — initialize it first" };
  }
  const trimmed = url.trim();
  if (!/^(https:\/\/|git@)[\w.@:/~-]+$/.test(trimmed)) {
    return { ok: false, error: "invalid remote url" };
  }
  const existing = git(["remote", "get-url", "origin"], projectPath);
  const res = existing.ok
    ? git(["remote", "set-url", "origin", trimmed], projectPath)
    : git(["remote", "add", "origin", trimmed], projectPath);
  if (!res.ok) return { ok: false, error: `git remote failed: ${res.stderr}` };
  return { ok: true, summary: `origin → ${trimmed}` };
}

/**
 * Pull upstream config/knowledge and update submoduled repos. Fast-forward
 * only (config state should never need a merge commit); chats are gitignored
 * so they're untouched.
 */
export function applyAgiUpstream(projectPath: string): AgiSyncResult {
  if (!isGitRepo(projectPath)) return { ok: false, error: "not a .agi envelope" };
  const origin = git(["remote", "get-url", "origin"], projectPath);
  if (!origin.ok || !origin.stdout) return { ok: false, error: "no origin remote configured" };

  const pull = git([...COMMIT_ENV, "pull", "--ff-only", "origin", "HEAD"], projectPath);
  if (!pull.ok && !/already up to date/i.test(pull.stdout + pull.stderr)) {
    return { ok: false, error: `pull failed (config state needs fast-forward): ${pull.stderr}` };
  }
  const sub = git(["submodule", "update", "--init", "--recursive"], projectPath);
  if (!sub.ok) {
    return { ok: false, error: `submodule update failed: ${sub.stderr}` };
  }
  return { ok: true, summary: "pulled config/knowledge + updated submodules" };
}

/**
 * Commit and push local config/knowledge changes. `.ai/chat/`, sandbox and
 * .trash are gitignored, so they can never be staged here.
 */
export function pushAgiState(projectPath: string): AgiSyncResult {
  if (!isGitRepo(projectPath)) return { ok: false, error: "not a .agi envelope" };
  const origin = git(["remote", "get-url", "origin"], projectPath);
  if (!origin.ok || !origin.stdout) return { ok: false, error: "no origin remote configured" };

  // Stage everything not gitignored (chats/sandbox/.trash are excluded by .gitignore).
  git(["add", "-A"], projectPath);
  const commit = git([...COMMIT_ENV, "commit", "-m", "Sync config + knowledge state"], projectPath);
  const nothing = /nothing to commit/i.test(commit.stdout + commit.stderr);
  if (!commit.ok && !nothing) {
    return { ok: false, error: `commit failed: ${commit.stderr}` };
  }
  const push = git(["push", "origin", "HEAD"], projectPath);
  if (!push.ok) return { ok: false, error: `push failed: ${push.stderr}` };
  return { ok: true, summary: nothing ? "nothing to push" : "pushed config + knowledge state" };
}
