/**
 * HuggingFace Marketplace — browse HF Hub, manage downloaded models, view running inference.
 * Three tabs: Models (browse + install), Installed (manage), Running (live stats + test).
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PageScroll } from "@/components/PageScroll.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useHFHardwareProfile,
  useHFModels,
  useHFInstalledModels,
  useHFRunningModels,
} from "../hooks.js";
import {
  installHFModel,
  startHFModel,
  stopHFModel,
  uninstallHFModel,
  testHFInference,
  fetchHFModelDetail,
} from "../api.js";
import type {
  HFModelSearchResult,
  HFInstalledModel,
  HFRunningModel,
  HFCompatibility,
  HFModelStatus,
  HFModelDetail,
  HFModelVariant,
  HFHardwareTier,
} from "../types.js";

// ---------------------------------------------------------------------------
// Tab setup
// ---------------------------------------------------------------------------

type Tab = "models" | "installed" | "running";

const tabs: { id: Tab; label: string }[] = [
  { id: "models", label: "Models" },
  { id: "installed", label: "Installed" },
  { id: "running", label: "Running" },
];

export default function HFMarketplacePage() {
  const [activeTab, setActiveTab] = useState<Tab>("models");

  return (
    <PageScroll>
      <div>
        {/* Tab bar */}
        <div className="flex gap-1 mb-6 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-4 py-2 text-[13px] font-medium border-b-2 transition-colors cursor-pointer bg-transparent",
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "models" && <ModelsTab />}
        {activeTab === "installed" && <InstalledTab />}
        {activeTab === "running" && <RunningTab />}
      </div>
    </PageScroll>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getCompatibilityColor(c: HFCompatibility): string {
  switch (c) {
    case "compatible": return "bg-green/15 text-green";
    case "limited": return "bg-yellow/15 text-yellow";
    case "incompatible": return "bg-red/15 text-red";
  }
}

function getStatusColor(s: HFModelStatus): string {
  switch (s) {
    case "running": return "bg-green";
    case "downloading":
    case "starting":
    case "stopping": return "bg-yellow";
    case "error": return "bg-red";
    case "ready":
    case "removing":
    default: return "bg-muted-foreground";
  }
}

function getStatusLabel(s: HFModelStatus): string {
  switch (s) {
    case "downloading": return "Downloading";
    case "ready": return "Ready";
    case "starting": return "Starting";
    case "running": return "Running";
    case "stopping": return "Stopping";
    case "error": return "Error";
    case "removing": return "Removing";
  }
}

function getTierColor(tier: HFHardwareTier): string {
  switch (tier) {
    case "pro": return "bg-green/10 border-green/30 text-green";
    case "accelerated": return "bg-blue/10 border-blue/30 text-blue";
    case "standard": return "bg-yellow/10 border-yellow/30 text-yellow";
    case "minimal": return "bg-muted border-border text-muted-foreground";
  }
}

function formatUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ---------------------------------------------------------------------------
// ModelsTab — browse HF Hub
// ---------------------------------------------------------------------------

const TASK_OPTIONS = [
  { value: "", label: "All Tasks" },
  { value: "text-generation", label: "Text Generation" },
  { value: "text-to-image", label: "Text to Image" },
  { value: "feature-extraction", label: "Feature Extraction" },
  { value: "automatic-speech-recognition", label: "Speech Recognition" },
  { value: "text-classification", label: "Text Classification" },
];

const SORT_OPTIONS = [
  { value: "downloads", label: "Most Downloads" },
  { value: "likes", label: "Most Likes" },
  { value: "trending", label: "Trending" },
  { value: "lastModified", label: "Recently Updated" },
];

function ModelsTab() {
  const [search, setSearch] = useState("");
  const [task, setTask] = useState("");
  const [sort, setSort] = useState("downloads");
  const [selectedModel, setSelectedModel] = useState<HFModelSearchResult | null>(null);

  const hw = useHFHardwareProfile();
  const hwData = hw.data;

  const modelsQuery = useHFModels({
    q: search || undefined,
    pipeline_tag: task || undefined,
    sort,
    limit: 30,
  });
  const models = modelsQuery.data ?? [];

  return (
    <div className="space-y-5">
      {/* Hardware banner */}
      {hwData && (
        <div className={cn("rounded-lg border px-4 py-3 flex items-center justify-between gap-4", getTierColor(hwData.capabilities.tier))}>
          <p className="text-[13px]">{hwData.capabilities.summary}</p>
          <Badge variant="outline" className={cn("text-[11px] shrink-0", getTierColor(hwData.capabilities.tier))}>
            {hwData.capabilities.tier.charAt(0).toUpperCase() + hwData.capabilities.tier.slice(1)}
          </Badge>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          placeholder="Search models..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-[13px]"
        />
        <select
          value={task}
          onChange={(e) => setTask(e.target.value)}
          className="text-[13px] rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {TASK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="text-[13px] rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {modelsQuery.isLoading && (
        <p className="text-[13px] text-muted-foreground">Loading models...</p>
      )}
      {modelsQuery.isError && (
        <div className="p-4 rounded-lg bg-surface0/50 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">HuggingFace Marketplace is not enabled</p>
          <p>Add <code className="px-1 py-0.5 bg-mantle rounded text-xs">{`"hf": { "enabled": true }`}</code> to your aionima.json config and restart the gateway.</p>
        </div>
      )}
      {!modelsQuery.isLoading && !modelsQuery.isError && models.length === 0 && (
        <p className="text-[13px] text-muted-foreground">No models found.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {models.map((model) => (
          <ModelCard key={model.id} model={model} onSelect={() => setSelectedModel(model)} />
        ))}
      </div>

      {selectedModel && (
        <ModelDetailDialog
          model={selectedModel}
          onClose={() => setSelectedModel(null)}
        />
      )}
    </div>
  );
}

function ModelCard({ model, onSelect }: { model: HFModelSearchResult; onSelect: () => void }) {
  const est = model.estimate;
  const perfParts: string[] = [];
  if (est.tokensPerSec !== null) perfParts.push(`~${est.tokensPerSec} tok/s`);
  if (est.diskUsageBytes > 0) perfParts.push(formatBytes(est.diskUsageBytes));

  return (
    <Card
      className="p-4 flex flex-col gap-3 cursor-pointer hover:border-primary/50 transition-colors"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold truncate">{model.modelId}</p>
          {model.author && (
            <p className="text-[11px] text-muted-foreground truncate">{model.author}</p>
          )}
        </div>
        {model.pipeline_tag && (
          <Badge variant="outline" className="text-[10px] shrink-0">{model.pipeline_tag}</Badge>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", getCompatibilityColor(model.compatibility))}>
          {model.compatibility === "compatible"
            ? "Compatible"
            : model.compatibility === "limited"
              ? "Limited"
              : model.compatibilityReason || "Incompatible"}
        </span>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span>{model.downloads.toLocaleString()} downloads</span>
        <span>{model.likes.toLocaleString()} likes</span>
      </div>

      {perfParts.length > 0 && (
        <p className="text-[11px] text-muted-foreground">{perfParts.join(", ")}</p>
      )}

      <div className="mt-auto pt-1">
        <Button
          size="sm"
          variant="outline"
          className="w-full text-[12px]"
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
        >
          Install
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ModelDetailDialog — variant selection + download
// ---------------------------------------------------------------------------

function ModelDetailDialog({
  model,
  onClose,
}: {
  model: HFModelSearchResult;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<HFModelDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingDetail(true);
    fetchHFModelDetail(model.modelId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [model.modelId]);

  const sortedVariants: HFModelVariant[] = detail?.variants.slice().sort((a, b) => {
    const compatOrder: Record<HFCompatibility, number> = { compatible: 0, limited: 1, incompatible: 2 };
    const diff = compatOrder[a.compatibility] - compatOrder[b.compatibility];
    if (diff !== 0) return diff;
    return a.sizeBytes - b.sizeBytes;
  }) ?? [];

  async function handleInstall(variant: HFModelVariant) {
    setInstalling(variant.filename);
    setInstallError(null);
    try {
      const result = await installHFModel(model.modelId, variant.filename);
      if (!result.ok) {
        setInstallError(result.error ?? "Installation failed");
      } else {
        onClose();
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Installation failed");
    } finally {
      setInstalling(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{model.modelId}</span>
            {model.pipeline_tag && (
              <Badge variant="outline" className="text-[10px]">{model.pipeline_tag}</Badge>
            )}
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", getCompatibilityColor(model.compatibility))}>
              {model.compatibility}
            </span>
          </DialogTitle>
          {model.author && (
            <p className="text-[12px] text-muted-foreground">by {model.author}</p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {loadingDetail && (
            <p className="text-[13px] text-muted-foreground">Loading variants...</p>
          )}

          {!loadingDetail && sortedVariants.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              No downloadable variants found for this model.
            </p>
          )}

          {sortedVariants.length > 0 && (
            <div className="space-y-2">
              <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">
                Available Variants
              </p>
              <div className="divide-y divide-border rounded-md border">
                {sortedVariants.map((v) => (
                  <div key={v.filename} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium truncate">{v.filename}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">{v.format.toUpperCase()}</span>
                        {v.quantization && (
                          <span className="text-[10px] text-muted-foreground">{v.quantization}</span>
                        )}
                        <span className="text-[10px] text-muted-foreground">{formatBytes(v.sizeBytes)}</span>
                      </div>
                    </div>
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0", getCompatibilityColor(v.compatibility))}>
                      {v.compatibility}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[11px] shrink-0"
                      disabled={installing !== null || v.compatibility === "incompatible"}
                      onClick={() => void handleInstall(v)}
                    >
                      {installing === v.filename ? "..." : "Download"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {installError && (
            <p className="text-[12px] text-red">{installError}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// InstalledTab — manage downloaded models
// ---------------------------------------------------------------------------

function InstalledTab() {
  const query = useHFInstalledModels();
  const models = query.data ?? [];
  const [pendingDelete, setPendingDelete] = useState<HFInstalledModel | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleToggle(model: HFInstalledModel) {
    setActionBusy(model.id);
    setActionError(null);
    try {
      if (model.status === "running") {
        await stopHFModel(model.id);
      } else {
        await startHFModel(model.id);
      }
      await query.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDelete(model: HFInstalledModel) {
    setActionBusy(model.id);
    setActionError(null);
    setPendingDelete(null);
    try {
      await uninstallHFModel(model.id);
      await query.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Uninstall failed");
    } finally {
      setActionBusy(null);
    }
  }

  if (query.isLoading) {
    return <p className="text-[13px] text-muted-foreground">Loading installed models...</p>;
  }

  if (models.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-[13px] text-muted-foreground">
          No models installed yet. Browse the Models tab to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {actionError && (
        <p className="text-[12px] text-red">{actionError}</p>
      )}

      {models.map((model) => {
        const isRunning = model.status === "running";
        const isBusy =
          actionBusy === model.id ||
          model.status === "downloading" ||
          model.status === "starting" ||
          model.status === "stopping" ||
          model.status === "removing";
        const canToggle = model.status === "ready" || model.status === "running";

        return (
          <Card key={model.id} className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[13px] font-semibold truncate">{model.displayName}</p>
                  <Badge variant="outline" className="text-[10px]">{model.runtimeType}</Badge>
                  {model.quantization && (
                    <Badge variant="outline" className="text-[10px]">{model.quantization}</Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{model.pipelineTag}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={cn(
                    "inline-block w-2 h-2 rounded-full",
                    getStatusColor(model.status),
                    model.status === "downloading" && "animate-pulse",
                  )}
                />
                <span className="text-[11px] text-muted-foreground">{getStatusLabel(model.status)}</span>
              </div>
            </div>

            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <span>{formatBytes(model.fileSizeBytes)}</span>
              {model.modelFilename && (
                <span className="truncate max-w-[200px]">{model.modelFilename}</span>
              )}
            </div>

            {model.error && (
              <p className="text-[11px] text-red">{model.error}</p>
            )}

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={isRunning ? "outline" : "default"}
                className="text-[12px]"
                disabled={isBusy || !canToggle}
                onClick={() => void handleToggle(model)}
              >
                {isBusy && actionBusy === model.id ? "..." : isRunning ? "Stop" : "Start"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-[12px] text-destructive hover:text-destructive"
                disabled={isBusy}
                onClick={() => setPendingDelete(model)}
              >
                Delete
              </Button>
            </div>
          </Card>
        );
      })}

      {pendingDelete && (
        <Dialog open onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete model?</DialogTitle>
            </DialogHeader>
            <p className="text-[13px] text-muted-foreground">
              This will permanently delete{" "}
              <span className="font-medium text-foreground">{pendingDelete.displayName}</span>{" "}
              and recover{" "}
              <span className="font-medium text-foreground">{formatBytes(pendingDelete.fileSizeBytes)}</span>{" "}
              of disk space.
            </p>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDelete(pendingDelete)}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunningTab — live inference stats + quick test
// ---------------------------------------------------------------------------

function RunningTab() {
  const query = useHFRunningModels();
  const models = query.data ?? [];

  if (query.isLoading) {
    return <p className="text-[13px] text-muted-foreground">Loading running models...</p>;
  }

  if (models.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-[13px] text-muted-foreground">No models are currently running.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {models.map((model) => (
        <RunningModelCard key={model.modelId} model={model} />
      ))}
    </div>
  );
}

function RunningModelCard({ model }: { model: HFRunningModel }) {
  const [prompt, setPrompt] = useState("");
  const [inferResult, setInferResult] = useState<{ response: string; latencyMs: number } | null>(null);
  const [inferRunning, setInferRunning] = useState(false);
  const [inferError, setInferError] = useState<string | null>(null);

  const handleInfer = useCallback(async () => {
    if (!prompt.trim()) return;
    setInferRunning(true);
    setInferError(null);
    setInferResult(null);
    try {
      const result = await testHFInference(model.modelId, prompt);
      setInferResult(result);
    } catch (err) {
      setInferError(err instanceof Error ? err.message : "Inference failed");
    } finally {
      setInferRunning(false);
    }
  }, [model.modelId, prompt]);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-semibold">{model.modelId}</p>
            <Badge variant="outline" className="text-[10px]">{model.runtimeType}</Badge>
          </div>
          <div className="flex items-center gap-4 mt-1 text-[11px] text-muted-foreground">
            <span>Port {model.port}</span>
            <span>Up {formatUptime(model.startedAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={cn(
              "inline-block w-2 h-2 rounded-full",
              model.healthCheckPassed ? "bg-green" : "bg-red",
            )}
          />
          <span className="text-[11px] text-muted-foreground">
            {model.healthCheckPassed ? "Healthy" : "Unhealthy"}
          </span>
        </div>
      </div>

      {/* Quick inference test */}
      <div className="space-y-2">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Quick Test
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="Enter a prompt..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 text-[13px]"
            onKeyDown={(e) => { if (e.key === "Enter" && !inferRunning) void handleInfer(); }}
          />
          <Button
            size="sm"
            disabled={inferRunning || !prompt.trim()}
            onClick={() => void handleInfer()}
          >
            {inferRunning ? "..." : "Run"}
          </Button>
        </div>

        {inferError && (
          <p className="text-[12px] text-red">{inferError}</p>
        )}

        {inferResult && (
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
            <p className="text-[12px] whitespace-pre-wrap">{inferResult.response}</p>
            <p className="text-[10px] text-muted-foreground">{inferResult.latencyMs}ms</p>
          </div>
        )}
      </div>
    </Card>
  );
}
