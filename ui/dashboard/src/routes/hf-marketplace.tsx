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
  HFQuantization,
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

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function getCompatibilityColor(c: HFCompatibility): string {
  switch (c) {
    case "compatible": return "bg-green/15 text-green";
    case "limited": return "bg-yellow/15 text-yellow";
    case "incompatible": return "bg-red/15 text-red";
  }
}

function getCompatibilityLabel(c: HFCompatibility): string {
  switch (c) {
    case "compatible": return "Compatible";
    case "limited": return "Limited";
    case "incompatible": return "Incompatible";
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
    case "downloading": return "Downloading...";
    case "ready": return "Ready to start";
    case "starting": return "Starting (pulling image & loading model)...";
    case "running": return "Running";
    case "stopping": return "Stopping...";
    case "error": return "Error";
    case "removing": return "Removing...";
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

/** Returns a plain-English quality label for a quantization level. */
function getQuantLabel(q: HFQuantization | null): string {
  if (!q) return "Full Model";
  switch (q) {
    case "Q2_K":
    case "Q3_K_S":
    case "Q3_K_M": return "Smallest — fastest, lower quality";
    case "Q3_K_L":
    case "Q4_0":
    case "Q4_K_S":
    case "Q4_K_M": return "Balanced — good quality, reasonable size";
    case "Q5_0":
    case "Q5_K_S":
    case "Q5_K_M": return "High quality — larger, slower";
    case "Q6_K":
    case "Q8_0": return "Very high quality — large file";
    case "F16":
    case "F32": return "Full precision — largest, requires GPU";
  }
}

/** Balanced quant levels that should get a "Recommended" badge. */
const RECOMMENDED_QUANTS = new Set<HFQuantization>(["Q4_0", "Q4_K_S", "Q4_K_M"]);

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
  { value: "trendingScore", label: "Trending" },
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-muted/20 h-36 animate-pulse" />
          ))}
        </div>
      )}
      {modelsQuery.isError && (
        <div className="p-4 rounded-lg bg-surface0/50 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">
            {modelsQuery.error?.message?.includes("not active") || modelsQuery.error?.message?.includes("not enabled")
              ? "HuggingFace Marketplace is not enabled"
              : "Failed to search models"}
          </p>
          <p>
            {modelsQuery.error?.message?.includes("not active") || modelsQuery.error?.message?.includes("not enabled")
              ? "Enable it in Settings > HF Marketplace."
              : modelsQuery.error?.message ?? "Check your network connection and try again."}
          </p>
        </div>
      )}
      {!modelsQuery.isLoading && !modelsQuery.isError && models.length === 0 && (
        <p className="text-[13px] text-muted-foreground">No models found.</p>
      )}

      {!modelsQuery.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {models.map((model) => (
            <ModelCard key={model.id} model={model} onSelect={() => setSelectedModel(model)} />
          ))}
        </div>
      )}

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
  const sizePart = est.diskUsageBytes > 0 ? `~${formatBytes(est.diskUsageBytes)}` : null;
  const toksPart = est.tokensPerSec !== null ? `~${est.tokensPerSec} tok/s` : null;
  const resourceLine = [sizePart, toksPart].filter(Boolean).join(" · ");

  return (
    <Card
      className="p-4 flex flex-col gap-3 cursor-pointer hover:border-primary/50 transition-colors"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold truncate">{model.id}</p>
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
          {getCompatibilityLabel(model.compatibility)}
        </span>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>{formatCount(model.downloads)} downloads</span>
        <span>{formatCount(model.likes)} likes</span>
      </div>

      {resourceLine && (
        <p className="text-[11px] text-muted-foreground">{resourceLine}</p>
      )}

      <div className="mt-auto pt-1">
        <Button
          size="sm"
          variant="outline"
          className="w-full text-[12px] cursor-pointer"
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

type InstallPhase = "idle" | "downloading" | "done" | "error";

function ModelDetailDialog({
  model,
  onClose,
}: {
  model: HFModelSearchResult;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<HFModelDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // Per-variant install state
  const [installPhase, setInstallPhase] = useState<InstallPhase>("idle");
  const [installingVariant, setInstallingVariant] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingDetail(true);
    fetchHFModelDetail(model.id)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [model.id]);

  const sortedVariants: HFModelVariant[] = detail?.variants.slice().sort((a, b) => {
    const compatOrder: Record<HFCompatibility, number> = { compatible: 0, limited: 1, incompatible: 2 };
    const diff = compatOrder[a.compatibility] - compatOrder[b.compatibility];
    if (diff !== 0) return diff;
    return a.sizeBytes - b.sizeBytes;
  }) ?? [];

  // Best compatible variant for recommendation callout
  const recommendedVariant = sortedVariants.find(
    (v) => v.compatibility === "compatible" && v.quantization && RECOMMENDED_QUANTS.has(v.quantization),
  ) ?? sortedVariants.find((v) => v.compatibility === "compatible");

  const allIncompatible =
    !loadingDetail &&
    sortedVariants.length > 0 &&
    sortedVariants.every((v) => v.compatibility === "incompatible");

  async function handleInstall(variant: HFModelVariant) {
    setInstallingVariant(variant.filename);
    setInstallPhase("downloading");
    setInstallError(null);
    try {
      const result = await installHFModel(model.id, variant.filename);
      if (!result.ok) {
        setInstallPhase("error");
        setInstallError(result.error ?? "Installation failed");
      } else {
        setInstallPhase("done");
      }
    } catch (err) {
      setInstallPhase("error");
      setInstallError(err instanceof Error ? err.message : "Installation failed");
    }
  }

  const isBusy = installPhase === "downloading";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{model.id}</span>
            {model.pipeline_tag && (
              <Badge variant="outline" className="text-[10px]">{model.pipeline_tag}</Badge>
            )}
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", getCompatibilityColor(model.compatibility))}>
              {getCompatibilityLabel(model.compatibility)}
            </span>
          </DialogTitle>
          {/* Author + stats line */}
          <p className="text-[12px] text-muted-foreground">
            {[
              model.author && `by ${model.author}`,
              model.downloads > 0 && `${formatCount(model.downloads)} downloads`,
              model.likes > 0 && `${formatCount(model.likes)} likes`,
            ].filter(Boolean).join(" · ")}
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Loading skeleton */}
          {loadingDetail && (
            <div className="space-y-2">
              <div className="h-4 rounded bg-muted/50 animate-pulse w-3/4" />
              <div className="h-16 rounded-md border border-border bg-muted/20 animate-pulse" />
              <div className="h-16 rounded-md border border-border bg-muted/20 animate-pulse" />
            </div>
          )}

          {/* No variants at all */}
          {!loadingDetail && detail && sortedVariants.length === 0 && (
            <div className="rounded-md border border-border bg-muted/20 px-4 py-3">
              <p className="text-[13px] text-muted-foreground">
                This model format is not yet supported. Aionima supports GGUF, SafeTensors, and ONNX models.
              </p>
            </div>
          )}

          {/* All variants incompatible */}
          {allIncompatible && (
            <div className="rounded-md border border-border bg-muted/20 px-4 py-3">
              <p className="text-[13px] text-muted-foreground">
                This model requires more resources than your hardware can provide.
                Check <span className="text-foreground font-medium">Settings &gt; HF Marketplace &gt; Hardware</span> for details.
              </p>
            </div>
          )}

          {/* Single-variant: simplified summary card */}
          {!loadingDetail && sortedVariants.length === 1 && !allIncompatible && (() => {
            const v = sortedVariants[0];
            const isInstalling = installingVariant === v.filename;
            return (
              <div className="space-y-3">
                <div className="rounded-md border border-border bg-muted/20 px-4 py-3">
                  <p className="text-[13px] text-foreground">
                    This model is{" "}
                    <span className="font-medium">{formatBytes(v.sizeBytes)}</span>{" "}
                    and is{" "}
                    <span className={cn("font-medium", v.compatibility === "compatible" ? "text-green" : v.compatibility === "limited" ? "text-yellow" : "text-red")}>
                      {getCompatibilityLabel(v.compatibility).toLowerCase()}
                    </span>{" "}
                    with your hardware.
                  </p>
                </div>

                {installPhase === "idle" && (
                  <Button
                    className="w-full cursor-pointer"
                    disabled={v.compatibility === "incompatible"}
                    onClick={() => void handleInstall(v)}
                  >
                    Install Model
                  </Button>
                )}

                {isInstalling && installPhase === "downloading" && (
                  <DownloadingNotice />
                )}

                {isInstalling && installPhase === "done" && (
                  <DoneNotice />
                )}

                {isInstalling && installPhase === "error" && installError && (
                  <p className="text-[12px] text-red">{installError}</p>
                )}

                {installPhase === "idle" && (
                  <p className="text-[11px] text-muted-foreground text-center">
                    After installing, start the model from the Installed tab to use it in your apps.
                  </p>
                )}
              </div>
            );
          })()}

          {/* Multi-variant list */}
          {!loadingDetail && sortedVariants.length > 1 && !allIncompatible && (
            <div className="space-y-3">
              {/* Recommendation callout */}
              {recommendedVariant && installPhase === "idle" && (
                <div className="rounded-md border border-green/30 bg-green/5 px-4 py-2.5">
                  <p className="text-[12px] text-green font-medium">
                    Recommended: {recommendedVariant.filename} ({formatBytes(recommendedVariant.sizeBytes)}) — best balance of quality and speed for your hardware
                  </p>
                </div>
              )}

              <div className="divide-y divide-border rounded-md border">
                {sortedVariants.map((v) => {
                  const isGguf = v.format === "gguf";
                  const qualityLabel = isGguf
                    ? getQuantLabel(v.quantization)
                    : `Full Model (${formatBytes(v.sizeBytes)})`;
                  const isRecommended =
                    recommendedVariant?.filename === v.filename;
                  const isInstalling = installingVariant === v.filename;

                  return (
                    <div key={v.filename} className="px-3 py-3 space-y-2">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[12px] font-medium">{qualityLabel}</p>
                            {isRecommended && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green/15 text-green">
                                Recommended
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-[11px] text-muted-foreground">{formatBytes(v.sizeBytes)}</span>
                            {isGguf && v.quantization && (
                              <span className="text-[10px] text-muted-foreground/60">{v.quantization}</span>
                            )}
                            <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", getCompatibilityColor(v.compatibility))}>
                              {getCompatibilityLabel(v.compatibility)}
                            </span>
                          </div>
                          {v.compatibility !== "compatible" && v.compatibilityReason && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">{v.compatibilityReason}</p>
                          )}
                        </div>

                        {/* Install button per variant */}
                        {isInstalling && installPhase === "downloading" ? (
                          <span className="text-[11px] text-muted-foreground shrink-0 pt-0.5">Downloading...</span>
                        ) : isInstalling && installPhase === "done" ? (
                          <span className="text-[11px] text-green shrink-0 pt-0.5">Installed</span>
                        ) : (
                          <Button
                            size="sm"
                            variant={isRecommended ? "default" : "outline"}
                            className="text-[11px] shrink-0 cursor-pointer"
                            disabled={isBusy || v.compatibility === "incompatible"}
                            onClick={() => void handleInstall(v)}
                          >
                            Install
                          </Button>
                        )}
                      </div>

                      {isInstalling && installPhase === "downloading" && (
                        <DownloadingNotice />
                      )}
                      {isInstalling && installPhase === "done" && (
                        <DoneNotice />
                      )}
                      {isInstalling && installPhase === "error" && installError && (
                        <p className="text-[12px] text-red">{installError}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" className="cursor-pointer" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DownloadingNotice() {
  return (
    <div className="rounded-md bg-muted/30 border border-border px-3 py-2 space-y-1">
      <p className="text-[12px] font-medium text-foreground">Preparing download...</p>
    </div>
  );
}

function DoneNotice() {
  return (
    <div className="rounded-md bg-blue/10 border border-blue/30 px-3 py-2 space-y-1">
      <p className="text-[12px] font-medium text-blue">Download started. This may take several minutes for large models.</p>
      <p className="text-[11px] text-muted-foreground">You can close this dialog. Check the Installed tab for download progress and to start the model when ready.</p>
    </div>
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
                    (model.status === "downloading" || model.status === "starting") && "animate-pulse",
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
                className="text-[12px] cursor-pointer"
                disabled={isBusy || !canToggle}
                onClick={() => void handleToggle(model)}
              >
                {isBusy && actionBusy === model.id ? "..." : isRunning ? "Stop" : "Start"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-[12px] text-destructive hover:text-destructive cursor-pointer"
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
              <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => setPendingDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="cursor-pointer"
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
        <RunningModelCard key={model.id} model={model} />
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
      const result = await testHFInference(model.id, prompt);
      setInferResult(result);
    } catch (err) {
      setInferError(err instanceof Error ? err.message : "Inference failed");
    } finally {
      setInferRunning(false);
    }
  }, [model.id, prompt]);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-semibold">{model.id}</p>
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
            className="cursor-pointer"
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
