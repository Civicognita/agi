/**
 * Workflows route — Taskmaster topology, worker catalog, system prompts, and PRIME truth.
 */

import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.js";
import { PageScroll } from "@/components/PageScroll.js";
import { WorkflowGraph } from "@/components/WorkflowGraph.js";
import { SystemPromptPipeline, PromptEntryList } from "@/components/PromptCatalog.js";
import { EditorFlyout } from "@/components/EditorFlyout.js";
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
      </Tabs>

      <EditorFlyout
        filePath={editorPath}
        onClose={() => setEditorPath(null)}
        theme={theme}
      />
    </PageScroll>
  );
}
