/**
 * COA Chain Explorer — Task #152
 *
 * Searchable, paginated view of Chain of Accountability records.
 * Shows fingerprint, entity, work type, timestamp, and linked $imp.
 */

import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { fetchCOAEntries } from "../api.js";
import type { COAExplorerEntry } from "../types.js";

export interface COAExplorerProps {
  entityId?: string;
  theme?: "light" | "dark";
}

const PAGE_SIZE = 25;

export function COAExplorer({ entityId }: COAExplorerProps) {
  const [entries, setEntries] = useState<COAExplorerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [workTypeFilter, setWorkTypeFilter] = useState("");

  const load = useCallback(async (pageOffset: number) => {
    setLoading(true);
    try {
      const result = await fetchCOAEntries({
        entityId,
        fingerprint: search || undefined,
        workType: workTypeFilter || undefined,
        limit: PAGE_SIZE,
        offset: pageOffset,
      });
      setEntries(result.entries);
      setTotal(result.total);
      setOffset(pageOffset);
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  }, [entityId, search, workTypeFilter]);

  useEffect(() => {
    void load(0);
  }, [load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <Card className="p-5 gap-0">
      <h3 className="text-base font-semibold text-card-foreground mb-4">COA Chain Explorer</h3>

      {/* Search / filter bar */}
      <div className="flex gap-2 mb-4">
        <Input
          type="text"
          placeholder="Search fingerprint..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void load(0); }}
          className="flex-1"
        />
        <Select
          className="w-[180px]"
          list={[
            { value: "__all__", label: "All work types" },
            { value: "message_in", label: "message_in" },
            { value: "message_out", label: "message_out" },
            { value: "tool_use", label: "tool_use" },
            { value: "task_dispatch", label: "task_dispatch" },
            { value: "verification", label: "verification" },
            { value: "artifact", label: "artifact" },
            { value: "commit", label: "commit" },
            { value: "action", label: "action" },
            { value: "mapp_mint", label: "mapp_mint" },
            { value: "mapp_install", label: "mapp_install" },
            { value: "mapp_publish", label: "mapp_publish" },
            { value: "mapp_execute", label: "mapp_execute" },
          ]}
          value={workTypeFilter || "__all__"}
          onValueChange={(v) => setWorkTypeFilter(v === "__all__" ? "" : v)}
          placeholder="All work types"
        />
        <Button onClick={() => void load(0)}>Search</Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-10 text-center text-muted-foreground">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground">No COA records found</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-mantle">
              {["Fingerprint", "Entity", "Work Type", "Action", "$imp", "Time"].map((h) => (
                <TableHead key={h} className="text-muted-foreground font-semibold">
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.fingerprint}>
                <TableCell className="text-blue font-mono text-[11px]">
                  {entry.fingerprint}
                </TableCell>
                <TableCell className="text-card-foreground">{entry.entityName}</TableCell>
                <TableCell className="text-muted-foreground">{entry.workType}</TableCell>
                <TableCell className="text-muted-foreground">{entry.action ?? "-"}</TableCell>
                <TableCell
                  className={cn(
                    "font-semibold",
                    entry.impScore === null
                      ? "text-muted-foreground"
                      : entry.impScore >= 0
                        ? "text-green"
                        : "text-red",
                  )}
                >
                  {entry.impScore !== null ? entry.impScore.toFixed(2) : "-"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-3">
          <span className="text-xs text-muted-foreground">
            Showing {offset + 1}-{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => void load(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
