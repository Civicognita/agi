/**
 * IdentityPeoplePanel — manage people the owner has APPROVED or REJECTED from
 * channels (Wave 1 s228; re-sourced from the entity store in the identity fix).
 *
 * APPROVED people are now sourced from the ENTITY STORE (the durable local
 * identity system) — a verified/sealed entity == an approved person — NOT from
 * the ephemeral pending-approval decision log, which only held pre-fix
 * snapshot-less rows and showed nothing. The controls let the owner edit project
 * access, revoke an approval (drops the entity back to unverified), or re-review
 * a rejection.
 *
 * Built on react-fancy/PAx primitives (Card, Badge, Button, Popover). Renders
 * nothing until at least one decided person exists, so it stays out of the way
 * on a fresh install.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover.js";
import {
  fetchIdentityPeople,
  fetchProjects,
  patchPersonProjects,
  revokePerson,
  reReviewPerson,
  type DecidedPerson,
} from "@/api.js";
import type { ProjectInfo } from "@/types.js";

function decidedAtLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Popover with project checkboxes — edits an approved person's project access. */
function ProjectsEditor({ person, projects, onSaved }: { person: DecidedPerson; projects: ProjectInfo[]; onSaved: () => void }) {
  const [selected, setSelected] = useState<string[]>(person.assignedProjectPaths ?? []);
  const [saving, setSaving] = useState(false);
  const toggle = (path: string) =>
    setSelected((s) => (s.includes(path) ? s.filter((x) => x !== path) : [...s, path]));
  const save = async () => {
    if (person.channelId === undefined || person.channelUserId === undefined) return;
    setSaving(true);
    try {
      await patchPersonProjects(person.channelId, person.channelUserId, selected);
      onSaved();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Popover>
      <PopoverTrigger>
        <Button variant="outline" size="sm" data-testid="person-edit-projects">Projects</Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 bg-popover border border-border rounded-lg z-[300] space-y-2">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Project access</p>
        {projects.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No projects available.</p>
        ) : (
          <div className="max-h-48 overflow-auto space-y-1">
            {projects.map((p) => (
              <label key={p.path} className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={selected.includes(p.path)} onChange={() => toggle(p.path)} />
                <span className="truncate">{p.name}</span>
              </label>
            ))}
          </div>
        )}
        <Button size="sm" onClick={() => void save()} disabled={saving} className="w-full">
          {saving ? "Saving…" : "Save"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function IdentityPeoplePanel() {
  const qc = useQueryClient();
  const { data: people = [], isLoading } = useQuery({
    queryKey: ["identity", "people", "all"],
    queryFn: () => fetchIdentityPeople(),
    staleTime: 30_000,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "for-identity"],
    queryFn: fetchProjects,
    staleTime: 60_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["identity", "people"] });

  // Keep the page clean until there's something to manage.
  if (isLoading || people.length === 0) return null;

  const approved = people.filter((p) => p.status === "approved");
  const rejected = people.filter((p) => p.status === "rejected");

  const row = (p: DecidedPerson) => {
    const key = `${p.channelId ?? ""}::${p.channelUserId ?? ""}`;
    const projectCount = p.assignedProjectPaths?.length ?? 0;
    return (
      <div key={key} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0" data-testid="decided-person-row">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{p.displayName ?? p.channelUserId ?? "Unknown"}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {p.channelId ?? "—"} · {decidedAtLabel(p.decidedAt)}
            {projectCount > 0 ? ` · ${String(projectCount)} project${projectCount === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <Badge className={p.status === "approved" ? "bg-green-500/15 text-green-400" : "bg-rose-500/15 text-rose-400"}>
          {p.status}
        </Badge>
        {p.status === "approved" ? (
          <>
            <ProjectsEditor person={p} projects={projects} onSaved={refresh} />
            <Button
              variant="outline"
              size="sm"
              data-testid="person-revoke"
              onClick={() => {
                if (p.channelId !== undefined && p.channelUserId !== undefined) void revokePerson(p.channelId, p.channelUserId).then(refresh);
              }}
            >
              Revoke
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            data-testid="person-re-review"
            onClick={() => {
              if (p.channelId !== undefined && p.channelUserId !== undefined) void reReviewPerson(p.channelId, p.channelUserId).then(refresh);
            }}
          >
            Re-review
          </Button>
        )}
      </div>
    );
  };

  return (
    <Card className="p-4 space-y-3" data-testid="identity-people-panel">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Approved &amp; rejected people</h2>
        <p className="text-[12px] text-muted-foreground">
          People you've approved or rejected from channels. Edit project access, revoke, or re-review.
        </p>
      </div>
      {approved.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Approved ({approved.length})</p>
          <div>{approved.map(row)}</div>
        </div>
      )}
      {rejected.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Rejected ({rejected.length})</p>
          <div>{rejected.map(row)}</div>
        </div>
      )}
    </Card>
  );
}
