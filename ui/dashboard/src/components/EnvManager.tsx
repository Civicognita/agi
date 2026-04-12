/**
 * EnvManager — read/write .env files for a project.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchProjectEnv, saveProjectEnv, fetchProjectFile } from "../api.js";

export interface EnvManagerProps {
  projectPath: string;
}

interface EnvEntry {
  id: number;
  key: string;
  value: string;
}

let nextId = 0;

export function EnvManager({ projectPath }: EnvManagerProps) {
  const [entries, setEntries] = useState<EnvEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [hasExample, setHasExample] = useState(false);
  const [showExampleBanner, setShowExampleBanner] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setHasExample(false);
    setShowExampleBanner(false);
    fetchProjectEnv(projectPath)
      .then((vars) => {
        const parsed = Object.entries(vars).map(([key, value]) => ({ id: nextId++, key, value }));
        setEntries(parsed);
        setDirty(false);
        // If no .env vars found, check for .env.example
        if (parsed.length === 0) {
          fetchProjectFile(`${projectPath}/.env.example`)
            .then(() => {
              setHasExample(true);
              setShowExampleBanner(true);
            })
            .catch(() => { /* no .env.example either */ });
        }
      })
      .catch(() => {
        // .env doesn't exist — check for .env.example
        setEntries([]);
        fetchProjectFile(`${projectPath}/.env.example`)
          .then(() => {
            setHasExample(true);
            setShowExampleBanner(true);
          })
          .catch(() => { /* no .env.example either */ });
      })
      .finally(() => setLoading(false));
  }, [projectPath]);

  const handleCreateFromExample = useCallback(async () => {
    try {
      const { content } = await fetchProjectFile(`${projectPath}/.env.example`);
      // Parse .env.example into key=value pairs
      const parsed = content
        .split("\n")
        .filter((line) => line.trim() && !line.trim().startsWith("#"))
        .map((line) => {
          const eqIdx = line.indexOf("=");
          if (eqIdx === -1) return { id: nextId++, key: line.trim(), value: "" };
          return { id: nextId++, key: line.slice(0, eqIdx).trim(), value: line.slice(eqIdx + 1).trim() };
        });
      setEntries(parsed);
      setDirty(true);
      setShowExampleBanner(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load .env.example");
    }
  }, [projectPath]);

  const handleChange = useCallback((id: number, field: "key" | "value", val: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: val } : e)));
    setDirty(true);
  }, []);

  const handleAdd = useCallback(() => {
    setEntries((prev) => [...prev, { id: nextId++, key: "", value: "" }]);
    setDirty(true);
  }, []);

  const handleRemove = useCallback((id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setDirty(true);
  }, []);

  const handleToggleReveal = useCallback((id: number) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const vars: Record<string, string> = {};
      for (const entry of entries) {
        const key = entry.key.trim();
        if (key) vars[key] = entry.value;
      }
      await saveProjectEnv(projectPath, vars);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [projectPath, entries]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Environment Variables
        </h4>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-6"
            onClick={handleAdd}
          >
            Add Variable
          </Button>
          {dirty && (
            <Button
              size="sm"
              className="text-xs h-6"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red">{error}</p>
      )}

      {showExampleBanner && hasExample && (
        <div className="rounded-lg border border-blue/30 bg-blue/5 p-3 flex items-center justify-between">
          <div>
            <p className="text-[12px] font-medium text-foreground">No .env file found</p>
            <p className="text-[11px] text-muted-foreground">A .env.example file was detected. Create your .env from the example template.</p>
          </div>
          <Button
            size="sm"
            className="text-xs h-7 shrink-0"
            onClick={() => void handleCreateFromExample()}
          >
            Create .env from Example
          </Button>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : entries.length === 0 && !showExampleBanner ? (
        <p className="text-xs text-muted-foreground">No environment variables. Click "Add Variable" to create one.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-1.5">
              <Input
                type="text"
                value={entry.key}
                onChange={(e) => handleChange(entry.id, "key", e.target.value)}
                placeholder="VARIABLE_NAME"
                className="text-[12px] h-7 font-mono flex-[2]"
              />
              <Input
                type={revealed.has(entry.id) ? "text" : "password"}
                value={entry.value}
                onChange={(e) => handleChange(entry.id, "value", e.target.value)}
                placeholder="value"
                className="text-[12px] h-7 font-mono flex-[3]"
              />
              <button
                onClick={() => handleToggleReveal(entry.id)}
                className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 w-8"
              >
                {revealed.has(entry.id) ? "Hide" : "Show"}
              </button>
              <button
                onClick={() => handleRemove(entry.id)}
                className="text-[10px] text-muted-foreground hover:text-red shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
