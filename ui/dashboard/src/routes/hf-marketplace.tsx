/**
 * HuggingFace Marketplace — browse HF Hub, manage downloaded models, view running inference.
 * Three tabs: Models (browse + install), Installed (manage), Running (live stats + test).
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
  useHFDatasets,
  useHFInstalledDatasets,
  useFineTuneJobs,
} from "../hooks.js";
import {
  installHFModel,
  startHFModel,
  stopHFModel,
  uninstallHFModel,
  testHFInference,
  fetchHFModelDetail,
  installHFDataset,
  uninstallHFDataset,
  analyzeHFModel,
  wizardInstallHFModel,
  startFineTuneJob,
  stopFineTuneJob,
  fetchHFBuildLog,
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
  HFDatasetSearchResult,
  HFInstalledDataset,
  HFModelAnalysis,
  HFFineTuneConfig,
  HFFineTuneJob,
} from "../types.js";

// ---------------------------------------------------------------------------
// Tab setup
// ---------------------------------------------------------------------------

type Tab = "models" | "installed" | "running" | "datasets" | "finetune";

const tabs: { id: Tab; label: string }[] = [
  { id: "models", label: "Models" },
  { id: "installed", label: "Installed" },
  { id: "running", label: "Running" },
  { id: "datasets", label: "Datasets" },
  { id: "finetune", label: "Fine-Tune" },
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
        {activeTab === "datasets" && <DatasetsTab />}
        {activeTab === "finetune" && <FineTuneTab />}
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
// ModelWizardDialog — multi-step install wizard for complex/custom models
// ---------------------------------------------------------------------------

type WizardStep = 0 | 1 | 2;
type WizardInstallPhase = "idle" | "installing" | "done" | "error";

function ModelWizardDialog({
  model,
  analysis,
  onClose,
}: {
  model: HFModelSearchResult;
  analysis: HFModelAnalysis;
  onClose: () => void;
}) {
  const [step, setStep] = useState<WizardStep>(0);
  const [selectedVariant, setSelectedVariant] = useState<HFModelVariant | null>(
    analysis.variants.find((v) => v.compatibility === "compatible") ?? analysis.variants[0] ?? null,
  );
  const [installPhase, setInstallPhase] = useState<WizardInstallPhase>("idle");
  const [installError, setInstallError] = useState<string | null>(null);

  const sortedVariants = analysis.variants.slice().sort((a, b) => {
    const compatOrder: Record<HFCompatibility, number> = { compatible: 0, limited: 1, incompatible: 2 };
    return compatOrder[a.compatibility] - compatOrder[b.compatibility] || a.sizeBytes - b.sizeBytes;
  });

  const runtimeLabel = analysis.isCustom ? "Custom Runtime" : analysis.runtimeType.charAt(0).toUpperCase() + analysis.runtimeType.slice(1);
  const runtimeColor = analysis.isCustom ? "bg-blue/15 text-blue" : "bg-green/15 text-green";

  async function handleInstall(startAfter: boolean) {
    setInstallPhase("installing");
    setInstallError(null);
    try {
      const result = await wizardInstallHFModel({
        modelId: model.id,
        filename: selectedVariant?.filename ?? undefined,
        runtimeType: analysis.runtimeType,
      });
      if (!result.ok) {
        setInstallPhase("error");
        setInstallError(result.error ?? "Installation failed");
      } else {
        setInstallPhase("done");
        void startAfter; // start is handled from Installed tab
      }
    } catch (err) {
      setInstallPhase("error");
      setInstallError(err instanceof Error ? err.message : "Installation failed");
    }
  }

  const stepLabels = ["Overview", "Configuration", "Review & Install"];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{model.id}</span>
            {model.pipeline_tag && (
              <Badge variant="outline" className="text-[10px]">{model.pipeline_tag}</Badge>
            )}
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", runtimeColor)}>
              {runtimeLabel}
            </span>
          </DialogTitle>
          {/* Step indicator */}
          <div className="flex items-center gap-2 mt-2">
            {stepLabels.map((label, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className={cn(
                  "text-[11px] font-medium px-2 py-0.5 rounded-full",
                  i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-green/20 text-green" : "bg-muted text-muted-foreground",
                )}>
                  {i + 1}
                </span>
                <span className={cn("text-[11px]", i === step ? "text-foreground font-medium" : "text-muted-foreground")}>
                  {label}
                </span>
                {i < stepLabels.length - 1 && (
                  <span className="text-muted-foreground/50 text-[10px]">›</span>
                )}
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Step 0: Overview */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-muted/20 p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-medium">{model.id}</p>
                    {model.author && (
                      <p className="text-[11px] text-muted-foreground">by {model.author}</p>
                    )}
                  </div>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", getCompatibilityColor(analysis.hardwareCompatibility.compatibility))}>
                    {getCompatibilityLabel(analysis.hardwareCompatibility.compatibility)}
                  </span>
                </div>
                {analysis.hardwareCompatibility.reason && (
                  <p className="text-[11px] text-muted-foreground">{analysis.hardwareCompatibility.reason}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Runtime Type</p>
                  <span className={cn("text-[11px] font-medium px-1.5 py-0.5 rounded", runtimeColor)}>
                    {runtimeLabel}
                  </span>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Estimated Size</p>
                  <p className="text-[12px] font-medium">
                    {analysis.estimatedResources.diskUsageBytes > 0
                      ? formatBytes(analysis.estimatedResources.diskUsageBytes)
                      : "Unknown"}
                  </p>
                </div>
              </div>

              {analysis.isCustom && analysis.customDefinition && (
                <div className="rounded-md border border-blue/30 bg-blue/5 p-3 space-y-1">
                  <p className="text-[12px] font-medium text-blue">Custom Runtime Detected</p>
                  <p className="text-[11px] text-muted-foreground">
                    {(analysis.customDefinition["description"] as string | undefined) ?? "This model uses a custom container runtime."}
                  </p>
                  {analysis.customDefinition["sourceRepo"] && (
                    <p className="text-[10px] text-muted-foreground">
                      Source: <span className="font-mono">{analysis.customDefinition["sourceRepo"] as string}</span>
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                {model.downloads > 0 && <span>{formatCount(model.downloads)} downloads</span>}
                {model.likes > 0 && <span>{formatCount(model.likes)} likes</span>}
              </div>
            </div>
          )}

          {/* Step 1: Configuration */}
          {step === 1 && (
            <div className="space-y-4">
              {analysis.isCustom ? (
                <div className="space-y-3">
                  <p className="text-[13px] font-medium">Custom Runtime Configuration</p>
                  <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
                    {analysis.customDefinition && (
                      <>
                        {analysis.customDefinition["sourceRepo"] && (
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Source Repository</p>
                            <p className="text-[12px] font-mono mt-0.5">{analysis.customDefinition["sourceRepo"] as string}</p>
                          </div>
                        )}
                        {analysis.customDefinition["endpoints"] && (
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-2">Endpoints</p>
                            <div className="space-y-0.5 mt-0.5">
                              {Object.entries(analysis.customDefinition["endpoints"] as Record<string, string>).map(([name, path]) => (
                                <p key={name} className="text-[11px]">
                                  <span className="text-muted-foreground">{name}:</span>{" "}
                                  <span className="font-mono">{path}</span>
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                        {analysis.customDefinition["internalPort"] && (
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-2">Container Port</p>
                            <p className="text-[12px] mt-0.5">{analysis.customDefinition["internalPort"] as number}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    A container will be built from the source repository. This may take several minutes on first install.
                  </p>
                </div>
              ) : sortedVariants.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-[13px] font-medium">Select Variant</p>
                  <div className="divide-y divide-border rounded-md border">
                    {sortedVariants.map((v) => {
                      const isRecommended =
                        v.compatibility === "compatible" &&
                        v.quantization !== null &&
                        RECOMMENDED_QUANTS.has(v.quantization as HFQuantization);
                      const qualityLabel = v.format === "gguf"
                        ? getQuantLabel(v.quantization)
                        : `Full Model (${formatBytes(v.sizeBytes)})`;
                      return (
                        <button
                          key={v.filename}
                          className={cn(
                            "w-full text-left px-3 py-3 space-y-1 cursor-pointer hover:bg-muted/30 transition-colors",
                            selectedVariant?.filename === v.filename && "bg-primary/5 border-l-2 border-primary",
                          )}
                          onClick={() => setSelectedVariant(v)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-[12px] font-medium">{qualityLabel}</p>
                              {isRecommended && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green/15 text-green">
                                  Recommended
                                </span>
                              )}
                              <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", getCompatibilityColor(v.compatibility))}>
                                {getCompatibilityLabel(v.compatibility)}
                              </span>
                            </div>
                            <span className="text-[11px] text-muted-foreground shrink-0">{formatBytes(v.sizeBytes)}</span>
                          </div>
                          {v.quantization && (
                            <p className="text-[10px] text-muted-foreground">{v.quantization}</p>
                          )}
                          {v.compatibility !== "compatible" && v.compatibilityReason && (
                            <p className="text-[10px] text-muted-foreground">{v.compatibilityReason}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-border bg-muted/20 px-4 py-3">
                  <p className="text-[13px] text-muted-foreground">
                    No compatible variants found. Aionima supports GGUF, SafeTensors, and ONNX models.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Review & Install */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-[13px] font-medium">Review & Install</p>

              <div className="rounded-md border border-border bg-muted/20 p-4 space-y-3">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-muted-foreground">Model</span>
                  <span className="font-medium">{model.id}</span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-muted-foreground">Runtime</span>
                  <span className={cn("font-medium px-1.5 py-0.5 rounded text-[10px]", runtimeColor)}>{runtimeLabel}</span>
                </div>
                {selectedVariant && (
                  <>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-muted-foreground">File</span>
                      <span className="font-mono text-[11px] truncate max-w-[240px]">{selectedVariant.filename}</span>
                    </div>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-muted-foreground">Disk space required</span>
                      <span className="font-medium">{formatBytes(selectedVariant.sizeBytes)}</span>
                    </div>
                  </>
                )}
                {analysis.isCustom && (
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">Container build</span>
                    <span className="text-blue font-medium">Required (may take minutes)</span>
                  </div>
                )}
              </div>

              {installPhase === "idle" && (
                <div className="flex flex-col gap-2">
                  <Button
                    className="w-full cursor-pointer"
                    onClick={() => void handleInstall(true)}
                    disabled={!analysis.isCustom && !selectedVariant}
                  >
                    Install &amp; Start
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full cursor-pointer"
                    onClick={() => void handleInstall(false)}
                    disabled={!analysis.isCustom && !selectedVariant}
                  >
                    Install Only
                  </Button>
                </div>
              )}

              {installPhase === "installing" && (
                <div className="rounded-md bg-muted/30 border border-border px-3 py-2">
                  <p className="text-[12px] font-medium text-foreground">
                    {analysis.isCustom ? "Building container and preparing model..." : "Preparing download..."}
                  </p>
                </div>
              )}

              {installPhase === "done" && (
                <div className="rounded-md bg-blue/10 border border-blue/30 px-3 py-2 space-y-1">
                  <p className="text-[12px] font-medium text-blue">
                    {analysis.isCustom ? "Container build started. This may take several minutes." : "Download started. This may take several minutes for large models."}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Check the Installed tab for progress and to start the model when ready.
                  </p>
                </div>
              )}

              {installPhase === "error" && installError && (
                <p className="text-[12px] text-red">{installError}</p>
              )}

              <p className="text-[11px] text-muted-foreground text-center">
                After installing, start the model from the Installed tab.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between">
          <div className="flex gap-2">
            {step > 0 && installPhase === "idle" && (
              <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => setStep((s) => (s - 1) as WizardStep)}>
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="cursor-pointer" onClick={onClose}>
              {installPhase === "done" ? "Close" : "Cancel"}
            </Button>
            {step < 2 && (
              <Button size="sm" className="cursor-pointer" onClick={() => setStep((s) => (s + 1) as WizardStep)}>
                Next
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ModelDetailDialog — variant selection + download (simple path for standard models)
// ---------------------------------------------------------------------------

type InstallPhase = "idle" | "downloading" | "done" | "error";

function ModelDetailDialog({
  model,
  onClose,
}: {
  model: HFModelSearchResult;
  onClose: () => void;
}) {
  const [analysis, setAnalysis] = useState<HFModelAnalysis | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [detail, setDetail] = useState<HFModelDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // Per-variant install state
  const [installPhase, setInstallPhase] = useState<InstallPhase>("idle");
  const [installingVariant, setInstallingVariant] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingAnalysis(true);
    setAnalyzeError(null);
    analyzeHFModel(model.id)
      .then(setAnalysis)
      .catch((err) => setAnalyzeError(err instanceof Error ? err.message : "Failed to analyze model"))
      .finally(() => setLoadingAnalysis(false));
  }, [model.id]);

  // Also fetch detailed info (for fallback) in parallel
  useEffect(() => {
    setLoadingDetail(true);
    fetchHFModelDetail(model.id)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [model.id]);

  // Once analysis is available, route to wizard for custom models, simple dialog for standard
  if (!loadingAnalysis && analysis && (analysis.isCustom || analysis.runtimeType === "custom")) {
    return <ModelWizardDialog model={model} analysis={analysis} onClose={onClose} />;
  }

  const sortedVariants: HFModelVariant[] = (analysis?.variants ?? detail?.variants ?? []).slice().sort((a, b) => {
    const compatOrder: Record<HFCompatibility, number> = { compatible: 0, limited: 1, incompatible: 2 };
    const diff = compatOrder[a.compatibility] - compatOrder[b.compatibility];
    if (diff !== 0) return diff;
    return a.sizeBytes - b.sizeBytes;
  });

  const isLoading = loadingAnalysis || loadingDetail;

  // Best compatible variant for recommendation callout
  const recommendedVariant = sortedVariants.find(
    (v) => v.compatibility === "compatible" && v.quantization && RECOMMENDED_QUANTS.has(v.quantization as HFQuantization),
  ) ?? sortedVariants.find((v) => v.compatibility === "compatible");

  const allIncompatible =
    !isLoading &&
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
          {isLoading && (
            <div className="space-y-2">
              <div className="h-4 rounded bg-muted/50 animate-pulse w-3/4" />
              <div className="h-16 rounded-md border border-border bg-muted/20 animate-pulse" />
              <div className="h-16 rounded-md border border-border bg-muted/20 animate-pulse" />
            </div>
          )}

          {/* Analyze error */}
          {analyzeError && (
            <div className="rounded-md border border-border bg-muted/20 px-4 py-3">
              <p className="text-[13px] text-muted-foreground">{analyzeError}</p>
            </div>
          )}

          {/* No variants at all */}
          {!isLoading && sortedVariants.length === 0 && !analyzeError && (
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
          {!isLoading && sortedVariants.length === 1 && !allIncompatible && (() => {
            const v = sortedVariants[0]!;
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
          {!isLoading && sortedVariants.length > 1 && !allIncompatible && (
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

function BuildLogPanel({ modelId }: { modelId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const data = await fetchHFBuildLog(modelId);
        if (active) {
          setLines(data.lines);
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        }
      } catch { /* ignore */ }
    }
    void poll();
    const interval = setInterval(() => void poll(), 2_000);
    return () => { active = false; clearInterval(interval); };
  }, [modelId]);

  if (lines.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      className="rounded-md bg-mantle border border-border p-2 max-h-[150px] overflow-y-auto font-mono text-[10px] text-subtext0 space-y-0.5"
    >
      {lines.map((line, i) => (
        <div key={i} className={cn(line.includes("FAILED") || line.includes("error") ? "text-red" : line.includes("successfully") || line.includes("built") ? "text-green" : "")}>
          {line}
        </div>
      ))}
    </div>
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
        const canToggle = model.status === "ready" || model.status === "running" || model.status === "error" || model.status === "failed";

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

            {(model.status === "starting" || model.status === "downloading") && (
              <BuildLogPanel modelId={model.id} />
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
  const query = useHFInstalledModels();
  const runningModels = (query.data ?? []).filter((m) => m.status === "running");

  if (query.isLoading) {
    return <p className="text-[13px] text-muted-foreground">Loading running models...</p>;
  }

  if (runningModels.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-[13px] text-muted-foreground">No models are currently running.</p>
        <p className="text-[11px] text-muted-foreground mt-1">Start a model from the Installed tab.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {runningModels.map((model) => (
        <RunningModelCard key={model.id} model={model} />
      ))}
    </div>
  );
}

function RunningModelCard({ model }: { model: HFInstalledModel }) {
  const [prompt, setPrompt] = useState("");
  const [inferResult, setInferResult] = useState<{ response: string; latencyMs: number } | null>(null);
  const [inferRunning, setInferRunning] = useState(false);
  const [inferError, setInferError] = useState<string | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);

  // Live health check
  useEffect(() => {
    if (!model.containerPort) return;
    let active = true;
    async function check() {
      try {
        const res = await fetch(`/api/hf/models/${encodeURIComponent(model.id)}/proxy/health`);
        if (active) setHealthOk(res.ok);
      } catch {
        if (active) setHealthOk(false);
      }
    }
    void check();
    const interval = setInterval(() => void check(), 10_000);
    return () => { active = false; clearInterval(interval); };
  }, [model.id, model.containerPort]);

  const isCustom = model.runtimeType === "custom";

  const handleInfer = useCallback(async () => {
    if (!prompt.trim()) return;
    setInferRunning(true);
    setInferError(null);
    setInferResult(null);
    try {
      if (isCustom) {
        // Custom models use the generic proxy — send to the first known endpoint or /predict
        const start = Date.now();
        const res = await fetch(`/api/hf/models/${encodeURIComponent(model.id)}/proxy/predict`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: prompt,
        });
        const latencyMs = Date.now() - start;
        const data = await res.text();
        setInferResult({ response: data.substring(0, 2000), latencyMs });
      } else {
        const result = await testHFInference(model.id, prompt);
        setInferResult(result);
      }
    } catch (err) {
      setInferError(err instanceof Error ? err.message : "Inference failed");
    } finally {
      setInferRunning(false);
    }
  }, [model.id, prompt, isCustom]);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-semibold">{model.displayName}</p>
            <Badge variant="outline" className="text-[10px]">{model.runtimeType}</Badge>
            {isCustom && <Badge variant="outline" className="text-[10px] border-blue text-blue">Custom</Badge>}
          </div>
          <div className="flex items-center gap-4 mt-1 text-[11px] text-muted-foreground">
            {model.containerPort && <span>Port {String(model.containerPort)}</span>}
            <span>{model.pipelineTag}</span>
            {model.quantization && <span>{model.quantization}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={cn(
              "inline-block w-2 h-2 rounded-full",
              healthOk === true ? "bg-green" : healthOk === false ? "bg-red" : "bg-yellow animate-pulse",
            )}
          />
          <span className="text-[11px] text-muted-foreground">
            {healthOk === true ? "Healthy" : healthOk === false ? "Unhealthy" : "Checking..."}
          </span>
        </div>
      </div>

      {/* Quick inference test */}
      <div className="space-y-2">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          {isCustom ? "API Test (JSON body → /predict)" : "Quick Test"}
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

// ---------------------------------------------------------------------------
// DatasetsTab — browse HF Hub datasets and manage installed datasets
// ---------------------------------------------------------------------------

const DATASET_SORT_OPTIONS = [
  { value: "downloads", label: "Most Downloads" },
  { value: "likes", label: "Most Likes" },
  { value: "trendingScore", label: "Trending" },
  { value: "lastModified", label: "Recently Updated" },
];

function DatasetsTab() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("downloads");
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const datasetsQuery = useHFDatasets({
    q: search || undefined,
    sort,
    limit: 30,
  });
  const datasets = datasetsQuery.data ?? [];

  const installedQuery = useHFInstalledDatasets();
  const installedDatasets = installedQuery.data ?? [];

  const installedIds = new Set(installedDatasets.map((d) => d.id));

  async function handleInstall(dataset: HFDatasetSearchResult) {
    setInstalling(dataset.id);
    setInstallError(null);
    try {
      const result = await installHFDataset(dataset.id);
      if (!result.ok) {
        setInstallError(result.error ?? "Installation failed");
      } else {
        await installedQuery.refetch();
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Installation failed");
    } finally {
      setInstalling(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Search + sort */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          placeholder="Search datasets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-[13px]"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="text-[13px] rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {DATASET_SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {installError && (
        <p className="text-[12px] text-red">{installError}</p>
      )}

      {datasetsQuery.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-muted/20 h-32 animate-pulse" />
          ))}
        </div>
      )}
      {datasetsQuery.isError && (
        <div className="p-4 rounded-lg bg-surface0/50 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Failed to search datasets</p>
          <p>{datasetsQuery.error?.message ?? "Check your network connection and try again."}</p>
        </div>
      )}
      {!datasetsQuery.isLoading && !datasetsQuery.isError && datasets.length === 0 && (
        <p className="text-[13px] text-muted-foreground">No datasets found.</p>
      )}

      {!datasetsQuery.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {datasets.map((dataset) => (
            <DatasetCard
              key={dataset.id}
              dataset={dataset}
              isInstalled={installedIds.has(dataset.id)}
              isInstalling={installing === dataset.id}
              onInstall={() => void handleInstall(dataset)}
            />
          ))}
        </div>
      )}

      {/* Installed datasets section */}
      {installedDatasets.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[13px] font-semibold">Installed Datasets</h3>
          {installedDatasets.map((dataset) => (
            <InstalledDatasetCard
              key={dataset.id}
              dataset={dataset}
              onDeleted={() => void installedQuery.refetch()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DatasetCard({
  dataset,
  isInstalled,
  isInstalling,
  onInstall,
}: {
  dataset: HFDatasetSearchResult;
  isInstalled: boolean;
  isInstalling: boolean;
  onInstall: () => void;
}) {
  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold truncate">{dataset.id}</p>
          {dataset.author && (
            <p className="text-[11px] text-muted-foreground truncate">{dataset.author}</p>
          )}
        </div>
        {dataset.gated && (
          <Badge variant="outline" className="text-[10px] shrink-0">Gated</Badge>
        )}
      </div>

      {dataset.description && (
        <p className="text-[11px] text-muted-foreground line-clamp-2">{dataset.description}</p>
      )}

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>{formatCount(dataset.downloads)} downloads</span>
        <span>{formatCount(dataset.likes)} likes</span>
      </div>

      {dataset.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {dataset.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
          ))}
          {dataset.tags.length > 3 && (
            <span className="text-[10px] text-muted-foreground">+{dataset.tags.length - 3}</span>
          )}
        </div>
      )}

      <div className="mt-auto pt-1">
        <Button
          size="sm"
          variant="outline"
          className="w-full text-[12px] cursor-pointer"
          disabled={isInstalled || isInstalling}
          onClick={onInstall}
        >
          {isInstalled ? "Installed" : isInstalling ? "Installing..." : "Install"}
        </Button>
      </div>
    </Card>
  );
}

function InstalledDatasetCard({
  dataset,
  onDeleted,
}: {
  dataset: HFInstalledDataset;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    setConfirmDelete(false);
    try {
      await uninstallHFDataset(dataset.id);
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  const isDownloading = dataset.status === "downloading";
  const isRemoving = dataset.status === "removing";
  const isBusy = deleting || isDownloading || isRemoving;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold truncate">{dataset.displayName}</p>
          <p className="text-[11px] text-muted-foreground truncate">{dataset.id}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={cn(
              "inline-block w-2 h-2 rounded-full",
              dataset.status === "ready" ? "bg-green" : dataset.status === "downloading" ? "bg-yellow animate-pulse" : dataset.status === "error" ? "bg-red" : "bg-muted-foreground",
            )}
          />
          <span className="text-[11px] text-muted-foreground capitalize">
            {dataset.status === "downloading" ? "Downloading..." : dataset.status === "removing" ? "Removing..." : dataset.status}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span>{formatBytes(dataset.fileSizeBytes)}</span>
        <span>{dataset.fileCount} files</span>
      </div>

      {dataset.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {dataset.tags.slice(0, 4).map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
          ))}
        </div>
      )}

      {dataset.error && (
        <p className="text-[11px] text-red">{dataset.error}</p>
      )}

      {deleteError && (
        <p className="text-[11px] text-red">{deleteError}</p>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="text-[12px] text-destructive hover:text-destructive cursor-pointer"
          disabled={isBusy}
          onClick={() => setConfirmDelete(true)}
        >
          Delete
        </Button>
      </div>

      {confirmDelete && (
        <Dialog open onOpenChange={(open) => { if (!open) setConfirmDelete(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete dataset?</DialogTitle>
            </DialogHeader>
            <p className="text-[13px] text-muted-foreground">
              This will permanently delete{" "}
              <span className="font-medium text-foreground">{dataset.displayName}</span>{" "}
              and recover{" "}
              <span className="font-medium text-foreground">{formatBytes(dataset.fileSizeBytes)}</span>{" "}
              of disk space.
            </p>
            <DialogFooter>
              <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="cursor-pointer"
                onClick={() => void handleDelete()}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// FineTuneTab — PEFT/LoRA fine-tuning (Phase 6)
// ---------------------------------------------------------------------------

const DEFAULT_FINETUNE_CONFIG: Omit<HFFineTuneConfig, "baseModelId" | "datasetId" | "outputName"> = {
  method: "lora",
  loraR: 8,
  loraAlpha: 32,
  loraDropout: 0.1,
  targetModules: ["q_proj", "v_proj"],
  epochs: 3,
  batchSize: 4,
  learningRate: 2e-5,
};

function FineTuneTab() {
  const installedModelsQuery = useHFInstalledModels();
  const installedDatasetsQuery = useHFInstalledDatasets();
  const jobsQuery = useFineTuneJobs();

  const installedModels = (installedModelsQuery.data ?? []).filter((m) => m.status === "ready" || m.status === "running");
  const installedDatasets = (installedDatasetsQuery.data ?? []).filter((d) => d.status === "ready");
  const jobs = jobsQuery.data ?? [];

  const [baseModelId, setBaseModelId] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [outputName, setOutputName] = useState("");
  const [method, setMethod] = useState<"lora" | "qlora">("lora");
  const [loraR, setLoraR] = useState(DEFAULT_FINETUNE_CONFIG.loraR);
  const [loraAlpha, setLoraAlpha] = useState(DEFAULT_FINETUNE_CONFIG.loraAlpha);
  const [loraDropout, setLoraDropout] = useState(DEFAULT_FINETUNE_CONFIG.loraDropout);
  const [targetModulesStr, setTargetModulesStr] = useState("q_proj,v_proj");
  const [epochs, setEpochs] = useState(DEFAULT_FINETUNE_CONFIG.epochs);
  const [batchSize, setBatchSize] = useState(DEFAULT_FINETUNE_CONFIG.batchSize);
  const [learningRate, setLearningRate] = useState(DEFAULT_FINETUNE_CONFIG.learningRate);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function handleStartTraining() {
    if (!baseModelId || !datasetId || !outputName.trim()) return;
    setStarting(true);
    setStartError(null);
    try {
      const config: HFFineTuneConfig = {
        baseModelId,
        datasetId,
        outputName: outputName.trim(),
        method,
        loraR,
        loraAlpha,
        loraDropout,
        targetModules: targetModulesStr.split(",").map((s) => s.trim()).filter(Boolean),
        epochs,
        batchSize,
        learningRate,
      };
      await startFineTuneJob(config);
      await jobsQuery.refetch();
      setOutputName("");
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start training");
    } finally {
      setStarting(false);
    }
  }

  async function handleStop(jobId: string) {
    try {
      await stopFineTuneJob(jobId);
      await jobsQuery.refetch();
    } catch {
      // Silently ignore stop errors
    }
  }

  const canStart = Boolean(baseModelId && datasetId && outputName.trim()) && !starting;

  return (
    <div className="space-y-6">
      {/* Configuration form */}
      <Card className="p-4 space-y-4">
        <p className="text-[13px] font-semibold">Start Fine-Tuning Job</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Base model selector */}
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Base Model</label>
            <select
              value={baseModelId}
              onChange={(e) => setBaseModelId(e.target.value)}
              className="w-full text-[13px] rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select an installed model...</option>
              {installedModels.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName}</option>
              ))}
            </select>
            {installedModels.length === 0 && (
              <p className="text-[10px] text-muted-foreground">No ready models. Install a model first.</p>
            )}
          </div>

          {/* Dataset selector */}
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Dataset</label>
            <select
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              className="w-full text-[13px] rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select an installed dataset...</option>
              {installedDatasets.map((d) => (
                <option key={d.id} value={d.id}>{d.displayName}</option>
              ))}
            </select>
            {installedDatasets.length === 0 && (
              <p className="text-[10px] text-muted-foreground">No ready datasets. Install a dataset first.</p>
            )}
          </div>
        </div>

        {/* Output name */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Output Adapter Name</label>
          <Input
            placeholder="my-adapter"
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            className="text-[13px]"
          />
        </div>

        {/* Method */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Method</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as "lora" | "qlora")}
            className="w-full text-[13px] rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="lora">LoRA</option>
            <option value="qlora">QLoRA (4-bit quantized, lower VRAM)</option>
          </select>
        </div>

        {/* LoRA config */}
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">LoRA Configuration</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Rank (r)</label>
              <Input
                type="number"
                min="1"
                max="64"
                value={loraR}
                onChange={(e) => setLoraR(Number(e.target.value))}
                className="text-[13px]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Alpha</label>
              <Input
                type="number"
                min="1"
                value={loraAlpha}
                onChange={(e) => setLoraAlpha(Number(e.target.value))}
                className="text-[13px]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Dropout</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={loraDropout}
                onChange={(e) => setLoraDropout(Number(e.target.value))}
                className="text-[13px]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Target Modules</label>
              <Input
                placeholder="q_proj,v_proj"
                value={targetModulesStr}
                onChange={(e) => setTargetModulesStr(e.target.value)}
                className="text-[13px]"
              />
            </div>
          </div>
        </div>

        {/* Training config */}
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Training Configuration</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Epochs</label>
              <Input
                type="number"
                min="1"
                value={epochs}
                onChange={(e) => setEpochs(Number(e.target.value))}
                className="text-[13px]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Batch Size</label>
              <Input
                type="number"
                min="1"
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                className="text-[13px]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Learning Rate</label>
              <Input
                type="number"
                step="1e-6"
                value={learningRate}
                onChange={(e) => setLearningRate(Number(e.target.value))}
                className="text-[13px]"
              />
            </div>
          </div>
        </div>

        {startError && (
          <p className="text-[12px] text-red">{startError}</p>
        )}

        <Button
          className="w-full cursor-pointer"
          disabled={!canStart}
          onClick={() => void handleStartTraining()}
        >
          {starting ? "Starting..." : "Start Training"}
        </Button>
      </Card>

      {/* Running jobs */}
      {jobs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[13px] font-semibold">Fine-Tune Jobs</h3>
          {jobs.map((job) => (
            <FineTuneJobCard key={job.id} job={job} onStop={() => void handleStop(job.id)} />
          ))}
        </div>
      )}

      {jobs.length === 0 && !starting && (
        <div className="py-8 text-center">
          <p className="text-[13px] text-muted-foreground">
            No fine-tuning jobs yet. Configure and start a training job above.
          </p>
        </div>
      )}
    </div>
  );
}

function FineTuneJobCard({ job, onStop }: { job: HFFineTuneJob; onStop: () => void }) {
  const cs = job.containerStatus;
  const epochDisplay = cs
    ? `${typeof cs.epoch === "number" ? cs.epoch.toFixed(1) : "0"} / ${cs.total_epochs}`
    : "—";
  const lossDisplay = cs?.loss !== null && cs?.loss !== undefined ? cs.loss.toFixed(4) : "—";
  const etaDisplay = cs?.eta_seconds !== null && cs?.eta_seconds !== undefined
    ? cs.eta_seconds > 60
      ? `${Math.floor(cs.eta_seconds / 60)}m ${cs.eta_seconds % 60}s`
      : `${cs.eta_seconds}s`
    : "—";

  const statusColor: Record<HFFineTuneJob["status"], string> = {
    pending: "bg-muted-foreground",
    building: "bg-yellow animate-pulse",
    training: "bg-blue animate-pulse",
    complete: "bg-green",
    error: "bg-red",
  };

  const isActive = job.status === "pending" || job.status === "building" || job.status === "training";

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-semibold truncate">{job.config.outputName}</p>
            <Badge variant="outline" className="text-[10px]">{job.config.method.toUpperCase()}</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {job.config.baseModelId} + {job.config.datasetId}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn("inline-block w-2 h-2 rounded-full", statusColor[job.status])} />
          <span className="text-[11px] text-muted-foreground capitalize">{job.status}</span>
        </div>
      </div>

      {(job.status === "training" || job.status === "complete") && (
        <div className="grid grid-cols-3 gap-3 text-[11px]">
          <div>
            <p className="text-muted-foreground">Epoch</p>
            <p className="font-medium">{epochDisplay}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Loss</p>
            <p className="font-medium">{lossDisplay}</p>
          </div>
          <div>
            <p className="text-muted-foreground">ETA</p>
            <p className="font-medium">{etaDisplay}</p>
          </div>
        </div>
      )}

      {job.error && (
        <p className="text-[11px] text-red">{job.error}</p>
      )}

      {job.status === "complete" && (
        <p className="text-[11px] text-green">
          Adapter saved to ~/.agi/finetune/{job.id}/{job.config.outputName}/
        </p>
      )}

      <div className="flex items-center gap-2">
        {isActive && (
          <Button
            size="sm"
            variant="outline"
            className="text-[12px] cursor-pointer"
            onClick={onStop}
          >
            Stop
          </Button>
        )}
        <span className="text-[10px] text-muted-foreground">Job {job.id}</span>
      </div>
    </Card>
  );
}
