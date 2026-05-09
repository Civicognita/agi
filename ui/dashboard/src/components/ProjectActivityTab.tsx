import { useEffect, useState } from "react";
import { fetchProjectActivitySummary, type ProjectActivitySummary } from "../api.js";
import { Card } from "./ui/card.js";

type Props = { projectPath: string };

const RANGE_DAYS = 90;

export function ProjectActivityTab({ projectPath }: Props) {
  const [summary, setSummary] = useState<ProjectActivitySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProjectActivitySummary(projectPath, RANGE_DAYS)
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectPath]);

  if (loading) return <Card className="p-4 text-sm text-muted-foreground">Loading activity…</Card>;
  if (error) return <Card className="p-4 text-sm text-destructive">Failed to load activity: {error}</Card>;
  if (!summary) return <Card className="p-4 text-sm text-muted-foreground">No activity data.</Card>;

  const max = Math.max(1, ...summary.dailyCounts);
  const avgPerDay = summary.total / Math.max(1, summary.days);
  const activeDays = summary.dailyCounts.filter((c) => c > 0).length;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold">Commit activity · last {summary.days} days</h3>
          <div className="text-xs text-muted-foreground">
            {summary.total} commits · {activeDays} active days · ~{avgPerDay.toFixed(1)}/day
          </div>
        </div>
        <div className="flex items-end gap-[2px] h-24" data-testid="project-activity-bars">
          {summary.dailyCounts.map((count, idx) => {
            const heightPct = count === 0 ? 0 : Math.max(4, (count / max) * 100);
            const dayKey = summary.dayKeys[idx] ?? "";
            return (
              <div
                key={idx}
                className="flex-1 bg-primary/60 rounded-sm transition-colors hover:bg-primary"
                style={{ height: `${heightPct}%`, minHeight: count > 0 ? "2px" : "0" }}
                title={`${dayKey}: ${count} commit${count === 1 ? "" : "s"}`}
                aria-label={`${dayKey}: ${count} commits`}
              />
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-2 px-[2px]">
          <span>{summary.dayKeys[0] ?? ""}</span>
          <span>{summary.dayKeys[summary.dayKeys.length - 1] ?? ""}</span>
        </div>
      </Card>
    </div>
  );
}
