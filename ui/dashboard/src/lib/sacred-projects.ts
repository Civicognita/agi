import type { ProjectInfo } from "@/types.js";

/** Aionima core five — Civicognita-owned. Consolidated into the
 *  Aionima sacred card per s119 (cycle 70). */
export const SACRED_PROJECTS = [
  { id: "agi", name: "AGI" },
  { id: "prime", name: "PRIME" },
  { id: "id", name: "ID" },
  { id: "marketplace", name: "Plugins" },
  { id: "mapp-marketplace", name: "MagicApps" },
] as const;

/** PAx — Particle-Academy ADF UI primitives. Consolidated into the
 *  PAx sacred card per s136 t522 (cycle 91), mirroring the Aionima
 *  pattern: 4 packages, one portal entry. */
export const PAX_SACRED_PROJECTS = [
  { id: "react-fancy", name: "react-fancy" },
  { id: "fancy-code", name: "fancy-code" },
  { id: "fancy-sheets", name: "fancy-sheets" },
  { id: "fancy-echarts", name: "fancy-echarts" },
] as const;

// Widen Set element type to string so .has(arbitraryString) typechecks
// against the literal-typed `as const` source arrays.
const SACRED_IDS = new Set<string>(SACRED_PROJECTS.map((p) => p.id));
const PAX_IDS = new Set<string>(PAX_SACRED_PROJECTS.map((p) => p.id));

function normalize(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? "";
}

export function isSacredProject(project: Pick<ProjectInfo, "name" | "path">): boolean {
  const name = normalize(project.name);
  const base = normalize(basename(project.path));
  return SACRED_IDS.has(name) || SACRED_IDS.has(base);
}

/** True when the project is a PAx ADF UI primitive fork (one of the
 *  four Particle-Academy packages cloned into the workspace). PAx
 *  forks render as a single sacred portal card, NOT as regular
 *  project tiles — matches the Aionima consolidation pattern. */
export function isPaxProject(project: Pick<ProjectInfo, "name" | "path">): boolean {
  const name = normalize(project.name);
  const base = normalize(basename(project.path));
  return PAX_IDS.has(name) || PAX_IDS.has(base);
}

export function matchSacredProject(projects: ProjectInfo[], id: string): ProjectInfo | null {
  const target = normalize(id);
  return projects.find((p) => {
    const name = normalize(p.name);
    const base = normalize(basename(p.path));
    return name === target || base === target;
  }) ?? null;
}

/** Find the PAx fork projects in a project list. Returns those that
 *  match a known PAx package id by name or path basename. */
export function matchPaxProjects(projects: ProjectInfo[]): ProjectInfo[] {
  return projects.filter(isPaxProject);
}
