/**
 * Vendors page — third-party processor tracking with DPA/BAA status.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PageScroll } from "@/components/PageScroll.js";
import { fetchVendors, upsertVendor, updateVendorDpa, updateVendorBaa, updateVendorCompliance } from "../api.js";

interface Vendor {
  id: string;
  name: string;
  type: string;
  description: string;
  complianceStatus: string;
  dpaSigned: boolean;
  baaSigned: boolean;
  lastReviewDate: string | null;
  nextReviewDate: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  compliant: "bg-green/15 text-green",
  review_needed: "bg-yellow/15 text-yellow",
  non_compliant: "bg-red/15 text-red",
  unknown: "bg-surface0 text-muted-foreground",
};

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("other");
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(() => {
    fetchVendors().then((data) => setVendors(data as Vendor[])).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleAdd = useCallback(async () => {
    if (!name.trim()) return;
    setAdding(true);
    await upsertVendor({ name: name.trim(), type });
    setName("");
    setShowAdd(false);
    setAdding(false);
    refresh();
  }, [name, type, refresh]);

  const handleToggle = useCallback(async (id: string, field: "dpa" | "baa", current: boolean) => {
    if (field === "dpa") await updateVendorDpa(id, !current);
    else await updateVendorBaa(id, !current);
    refresh();
  }, [refresh]);

  const handleCompliance = useCallback(async (id: string, status: string) => {
    await updateVendorCompliance(id, status);
    refresh();
  }, [refresh]);

  return (
    <PageScroll>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Vendor Management</h2>
          <p className="text-sm text-muted-foreground">Track third-party processors, DPA/BAA status, and compliance reviews.</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "Add Vendor"}
        </Button>
      </div>

      {showAdd && (
        <Card className="p-4 flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Type</label>
            <Select
              className="text-[13px]"
              list={[
                { value: "llm_provider", label: "LLM Provider" },
                { value: "oauth_provider", label: "OAuth Provider" },
                { value: "voice_provider", label: "Voice Provider" },
                { value: "hosting", label: "Hosting" },
                { value: "payment", label: "Payment" },
                { value: "other", label: "Other" },
              ]}
              value={type}
              onValueChange={setType}
            />
          </div>
          <Button size="sm" onClick={() => void handleAdd()} disabled={adding || !name.trim()}>
            {adding ? "Adding..." : "Add"}
          </Button>
        </Card>
      )}

      <Card className="overflow-hidden">
        {vendors.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">No vendors tracked. Providers are auto-populated from your config on restart.</div>
        ) : (
          <div className="divide-y divide-border">
            {vendors.map((v) => {
              const reviewOverdue = v.nextReviewDate && new Date(v.nextReviewDate) < new Date();
              return (
                <div key={v.id} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{v.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface0 text-muted-foreground">{v.type.replace(/_/g, " ")}</span>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", STATUS_COLORS[v.complianceStatus] ?? "")}>
                        {v.complianceStatus.replace(/_/g, " ")}
                      </span>
                    </div>
                    <Select
                      className="text-[11px]"
                      list={[
                        { value: "compliant", label: "Compliant" },
                        { value: "review_needed", label: "Review Needed" },
                        { value: "non_compliant", label: "Non-Compliant" },
                        { value: "unknown", label: "Unknown" },
                      ]}
                      value={v.complianceStatus}
                      onValueChange={(val) => void handleCompliance(v.id, val)}
                    />
                  </div>
                  <div className="flex items-center gap-4 text-[11px]">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={v.dpaSigned} onChange={() => void handleToggle(v.id, "dpa", v.dpaSigned)} className="w-3.5 h-3.5" />
                      <span className="text-muted-foreground">DPA Signed</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={v.baaSigned} onChange={() => void handleToggle(v.id, "baa", v.baaSigned)} className="w-3.5 h-3.5" />
                      <span className="text-muted-foreground">BAA Signed</span>
                    </label>
                    {v.lastReviewDate && (
                      <span className="text-muted-foreground">Last review: {new Date(v.lastReviewDate).toLocaleDateString()}</span>
                    )}
                    {v.nextReviewDate && (
                      <span className={reviewOverdue ? "text-red font-semibold" : "text-muted-foreground"}>
                        Next review: {new Date(v.nextReviewDate).toLocaleDateString()}{reviewOverdue ? " (OVERDUE)" : ""}
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
