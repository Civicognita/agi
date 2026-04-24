import type { ProjectInfo } from "@/types.js";

export const SACRED_PROJECTS = [
  { id: "agi", name: "AGI" },
  { id: "prime", name: "PRIME" },
  { id: "id", name: "ID" },
  { id: "marketplace", name: "Plugins" },
  { id: "mapp-marketplace", name: "MagicApps" },
] as const;

const SACRED_IDS = new Set(SACRED_PROJECTS.map((p) => p.id));

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

export function matchSacredProject(projects: ProjectInfo[], id: string): ProjectInfo | null {
  const target = normalize(id);
  return projects.find((p) => {
    const name = normalize(p.name);
    const base = normalize(basename(p.path));
    return name === target || base === target;
  }) ?? null;
}
