/**
 * Incidents page — security incident tracking with notification clocks.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PageScroll } from "@/components/PageScroll.js";
import { fetchIncidents, createIncident, updateIncidentStatus } from "../api.js";

interface Incident {
  id: string;
  severity: string;
  status: string;
  breachClassification: string;
  title: string;
  description: string;
  affectedDataTypes: string[];
  detectionTime: string;
  gdprDeadline: string | null;
  hipaaDeadline: string | null;
  createdAt: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red/15 text-red",
  high: "bg-peach/15 text-peach",
  medium: "bg-yellow/15 text-yellow",
  low: "bg-blue/15 text-blue",
  info: "bg-surface0 text-muted-foreground",
};

const STATUS_COLORS: Record<string, string> = {
  detected: "bg-red/15 text-red",
  investigating: "bg-yellow/15 text-yellow",
  contained: "bg-blue/15 text-blue",
  resolved: "bg-green/15 text-green",
  closed: "bg-surface0 text-muted-foreground",
};

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    fetchIncidents().then((data) => setIncidents(data as Incident[])).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = useCallback(async () => {
    if (!title.trim()) return;
    setCreating(true);
    await createIncident({ severity, title: title.trim(), description: description.trim() });
    setTitle("");
    setDescription("");
    setShowCreate(false);
    setCreating(false);
    refresh();
  }, [severity, title, description, refresh]);

  const handleStatusChange = useCallback(async (id: string, status: string) => {
    await updateIncidentStatus(id, status);
    refresh();
  }, [refresh]);

  return (
    <PageScroll>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Security Incidents</h2>
          <p className="text-sm text-muted-foreground">Track and manage security incidents with breach notification clocks.</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Cancel" : "Report Incident"}
        </Button>
      </div>

      {showCreate && (
        <Card className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Incident title" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Severity</label>
              <Select
                className="text-[13px]"
                list={[
                  { value: "critical", label: "Critical" },
                  { value: "high", label: "High" },
                  { value: "medium", label: "Medium" },
                  { value: "low", label: "Low" },
                  { value: "info", label: "Info" },
                ]}
                value={severity}
                onValueChange={setSeverity}
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What happened?" />
          </div>
          <Button size="sm" onClick={() => void handleCreate()} disabled={creating || !title.trim()}>
            {creating ? "Creating..." : "Create Incident"}
          </Button>
        </Card>
      )}

      <Card className="overflow-hidden">
        {incidents.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">No incidents recorded.</div>
        ) : (
          <div className="divide-y divide-border">
            {incidents.map((inc) => {
              const gdprOverdue = inc.gdprDeadline && new Date(inc.gdprDeadline) < new Date();
              const hipaaOverdue = inc.hipaaDeadline && new Date(inc.hipaaDeadline) < new Date();
              return (
                <div key={inc.id} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", SEVERITY_COLORS[inc.severity] ?? "")}>
                        {inc.severity}
                      </span>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded", STATUS_COLORS[inc.status] ?? "")}>
                        {inc.status}
                      </span>
                      <span className="text-sm font-medium text-foreground">{inc.title}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {inc.status !== "closed" && (
                        <Select
                          className="text-[11px]"
                          list={[
                            { value: "detected", label: "Detected" },
                            { value: "investigating", label: "Investigating" },
                            { value: "contained", label: "Contained" },
                            { value: "resolved", label: "Resolved" },
                            { value: "closed", label: "Closed" },
                          ]}
                          value={inc.status}
                          onValueChange={(v) => void handleStatusChange(inc.id, v)}
                        />
                      )}
                    </div>
                  </div>
                  {inc.description && (
                    <p className="text-[12px] text-muted-foreground mb-1">{inc.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>Detected: {new Date(inc.detectionTime).toLocaleString()}</span>
                    {inc.gdprDeadline && (
                      <span className={gdprOverdue ? "text-red font-semibold" : ""}>
                        GDPR deadline: {new Date(inc.gdprDeadline).toLocaleString()}{gdprOverdue ? " (OVERDUE)" : ""}
                      </span>
                    )}
                    {inc.hipaaDeadline && (
                      <span className={hipaaOverdue ? "text-red font-semibold" : ""}>
                        HIPAA deadline: {new Date(inc.hipaaDeadline).toLocaleDateString()}{hipaaOverdue ? " (OVERDUE)" : ""}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
    </PageScroll>
  );
}
