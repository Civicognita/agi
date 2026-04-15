/**
 * Workflows route — Taskmaster topology, worker catalog, system prompts, PRIME truth,
 * and HuggingFace model workflows.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.js";
import { PageScroll } from "@/components/PageScroll.js";
import { WorkflowGraph } from "@/components/WorkflowGraph.js";
import { SystemPromptPipeline, PromptEntryList } from "@/components/PromptCatalog.js";
import { EditorFlyout } from "@/components/EditorFlyout.js";
import { Card } from "@/components/ui/card.js";
import { Badge } from "@/components/ui/badge.js";
import {
  SYSTEM_PROMPT_SECTIONS,
  PRIME_TRUTH_ENTRIES,
  WORKER_ENTRIES,
  TASKMASTER_ENTRY,
  AGENT_ENTRIES,
  COMMAND_ENTRIES,
} from "@/components/prompt-catalog.js";
import type { PromptEntry } from "@/components/prompt-catalog.js";
import { useRootContext } from "./root.js";
import { useHFHardwareProfile } from "../hooks.js";

export default function WorkflowsPage() {
  const { theme, configHook } = useRootContext();
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [workerEntries, setWorkerEntries] = useState<PromptEntry[]>(WORKER_ENTRIES);

  // Fetch dynamic worker catalog from API, fall back to static catalog
  useEffect(() => {
    fetch("/api/workers/catalog")
      .then((res) => res.ok ? res.json() as Promise<Array<{ id: string; title: string; description: string; domain: string; role: string; model: string; color: string; filePath: string }>> : null)
      .then((data) => {
        if (data && data.length > 0) {
          setWorkerEntries(data.map((w) => ({
            id: w.id,
            title: w.title,
            description: w.description,
            filePath: w.filePath,
            category: "worker" as const,
            model: w.model as "sonnet" | "haiku" | "opus",
            tags: [w.domain, w.role],
          })));
        }
      })
      .catch(() => { /* keep static fallback */ });
  }, []);

  return (
    <PageScroll>
      <Tabs defaultValue="topology">
        <TabsList variant="line">
          <TabsTrigger value="topology">Topology</TabsTrigger>
          <TabsTrigger value="taskmaster">Taskmaster</TabsTrigger>
          <TabsTrigger value="workers">Workers</TabsTrigger>
          <TabsTrigger value="system-prompt">System Prompt</TabsTrigger>
          <TabsTrigger value="prime">PRIME Truth</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="hf-models">HF Models</TabsTrigger>
        </TabsList>

        <TabsContent value="topology">
          <WorkflowGraph
            theme={theme}
            config={configHook.data}
            onSaveConfig={configHook.save}
          />
        </TabsContent>

        <TabsContent value="taskmaster" className="mt-4">
          <PromptEntryList entries={[TASKMASTER_ENTRY]} onFileOpen={setEditorPath} />
        </TabsContent>

        <TabsContent value="workers" className="mt-4">
          <PromptEntryList entries={workerEntries} onFileOpen={setEditorPath} />
        </TabsContent>

        <TabsContent value="system-prompt" className="mt-4">
          <SystemPromptPipeline entries={SYSTEM_PROMPT_SECTIONS} />
        </TabsContent>

        <TabsContent value="prime" className="mt-4">
          <PromptEntryList entries={PRIME_TRUTH_ENTRIES} onFileOpen={setEditorPath} />
        </TabsContent>

        <TabsContent value="agents" className="mt-4">
          <PromptEntryList entries={[...AGENT_ENTRIES, ...COMMAND_ENTRIES]} onFileOpen={setEditorPath} />
        </TabsContent>

        <TabsContent value="hf-models" className="mt-4">
          <HFModelWorkflows />
        </TabsContent>
      </Tabs>

      <EditorFlyout
        filePath={editorPath}
        onClose={() => setEditorPath(null)}
        theme={theme}
      />
    </PageScroll>
  );
}

// ---------------------------------------------------------------------------
// HF Model Workflows — informational cards linking to HF Marketplace pages
// ---------------------------------------------------------------------------

interface WorkflowStep {
  label: string;
}

interface WorkflowCard {
  title: string;
  description: string;
  steps: WorkflowStep[];
  note?: string;
  /** Where the primary link button goes. */
  linkTo: string;
  linkLabel: string;
  /** Pill badge label. */
  badge?: string;
  /** Code example to show (curl command, etc.). */
  codeExample?: string;
}

const HF_WORKFLOW_CARDS: WorkflowCard[] = [
  {
    title: "Download & Serve Model",
    description: "Download a model from HuggingFace and start serving it locally via a Podman container.",
    badge: "Getting Started",
    steps: [
      { label: "Browse HF Models page" },
      { label: "Select a compatible variant" },
      { label: "Download model files" },
      { label: "Start container" },
      { label: "Model ready for inference" },
    ],
    linkTo: "/hf-marketplace",
    linkLabel: "Browse HF Models",
  },
  {
    title: "Embed Text with Local Model",
    description: "Use a locally-running embedding model for semantic search, RAG pipelines, or similarity matching.",
    badge: "Embeddings",
    steps: [
      { label: "Install an embedding model (feature-extraction pipeline)" },
      { label: "Start the model container" },
      { label: "Call the /v1/embeddings API" },
    ],
    codeExample: `curl -X POST http://localhost:3100/api/hf/inference/{modelId}/embed \\
  -H 'Content-Type: application/json' \\
  -d '{"input": "Your text here"}'`,
    linkTo: "/hf-marketplace",
    linkLabel: "Install Embedding Model",
  },
  {
    title: "Run Local LLM",
    description: "Chat with a locally-running language model. Uses llama.cpp for fast CPU/GPU inference.",
    badge: "Language Model",
    note: "Requires llama.cpp runtime image (ghcr.io/ggerganov/llama.cpp:server). GGUF format models only.",
    steps: [
      { label: "Install a GGUF model (text-generation pipeline)" },
      { label: "Start the model container" },
      { label: "Use via the agent or call the /api/hf/inference/{id}/chat endpoint" },
    ],
    codeExample: `curl -X POST http://localhost:3100/api/hf/inference/{modelId}/chat \\
  -H 'Content-Type: application/json' \\
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'`,
    linkTo: "/hf-marketplace",
    linkLabel: "Install LLM",
  },
  {
    title: "Generate Images Locally",
    description: "Generate images from text prompts using a locally-running diffusion model.",
    badge: "Image Generation",
    note: "Requires a GPU with at least 4 GB VRAM for practical performance.",
    steps: [
      { label: "Install a diffusion model (text-to-image pipeline)" },
      { label: "Start the model container" },
      { label: "Call the /v1/generate API" },
    ],
    codeExample: `curl -X POST http://localhost:3100/api/hf/inference/{modelId}/generate \\
  -H 'Content-Type: application/json' \\
  -d '{"prompt": "A photo of a cat"}'`,
    linkTo: "/hf-marketplace",
    linkLabel: "Install Diffusion Model",
  },
];

function HFModelWorkflows() {
  const hw = useHFHardwareProfile();
  const hwData = hw.data;

  // Determine if HF Marketplace is enabled by checking if hardware data loaded without a 503
  const hfEnabled = !hw.isError;
  const hfStatusLabel = hfEnabled ? "Enabled" : "Disabled";
  const hfStatusClass = hfEnabled
    ? "bg-green/10 text-green border-green/30"
    : "bg-muted text-muted-foreground border-border";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold">HuggingFace Model Workflows</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Common patterns for downloading, serving, and using local HF models.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">HF Marketplace:</span>
          <Badge variant="outline" className={`text-[10px] ${hfStatusClass}`}>
            {hfStatusLabel}
          </Badge>
          {hwData && (
            <Badge variant="outline" className="text-[10px]">
              {hwData.capabilities.tier.charAt(0).toUpperCase() + hwData.capabilities.tier.slice(1)} tier
            </Badge>
          )}
        </div>
      </div>

      {!hfEnabled && (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
          <p className="text-[13px] text-muted-foreground">
            HF Marketplace is not enabled. Enable it in{" "}
            <Link to="/settings/hf" className="text-foreground underline underline-offset-2">
              Settings &gt; HF Marketplace
            </Link>{" "}
            to start downloading and serving local models.
          </p>
        </div>
      )}

      {/* Workflow cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {HF_WORKFLOW_CARDS.map((card) => (
          <HFWorkflowCard key={card.title} card={card} />
        ))}
      </div>
    </div>
  );
}

function HFWorkflowCard({ card }: { card: WorkflowCard }) {
  const [showCode, setShowCode] = useState(false);

  return (
    <Card className="p-4 flex flex-col gap-3">
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">{card.title}</p>
          <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{card.description}</p>
        </div>
        {card.badge && (
          <Badge variant="outline" className="text-[10px] shrink-0">{card.badge}</Badge>
        )}
      </div>

      {/* Steps */}
      <ol className="space-y-1">
        {card.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="text-[10px] font-mono text-muted-foreground/60 mt-0.5 min-w-[18px]">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="text-[12px] text-muted-foreground">{step.label}</span>
          </li>
        ))}
      </ol>

      {/* Note */}
      {card.note && (
        <p className="text-[11px] text-muted-foreground/70 border-l-2 border-border pl-2">{card.note}</p>
      )}

      {/* Code example toggle */}
      {card.codeExample && (
        <div>
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-0"
            onClick={() => setShowCode((v) => !v)}
          >
            {showCode ? "Hide example" : "Show example curl"}
          </button>
          {showCode && (
            <pre className="mt-2 rounded-md bg-muted/50 border border-border p-3 text-[10px] font-mono whitespace-pre-wrap break-all leading-relaxed overflow-x-auto">
              {card.codeExample}
            </pre>
          )}
        </div>
      )}

      {/* Link */}
      <div className="mt-auto pt-1">
        <Link
          to={card.linkTo}
          className="inline-flex items-center text-[12px] text-primary hover:underline underline-offset-2"
        >
          {card.linkLabel} &rarr;
        </Link>
      </div>
    </Card>
  );
}
