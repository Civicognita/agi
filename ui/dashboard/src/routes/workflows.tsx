/**
 * Workflows route — Worker topology, system prompts, and workflow documentation.
 */

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.js";
import { WorkflowGraph } from "@/components/WorkflowGraph.js";
import { SystemPromptPipeline, PromptEntryList } from "@/components/PromptCatalog.js";
import { EditorFlyout } from "@/components/EditorFlyout.js";
import {
  SYSTEM_PROMPT_SECTIONS,
  PRIME_TRUTH_ENTRIES,
  WORKER_ENTRIES,
  AGENT_ENTRIES,
  COMMAND_ENTRIES,
} from "@/components/prompt-catalog.js";
import { useRootContext } from "./root.js";

export default function WorkflowsPage() {
  const { theme, configHook } = useRootContext();
  const [editorPath, setEditorPath] = useState<string | null>(null);

  return (
    <>
      <Tabs defaultValue="topology">
        <TabsList variant="line">
          <TabsTrigger value="topology">Topology</TabsTrigger>
          <TabsTrigger value="system-prompt">System Prompt</TabsTrigger>
          <TabsTrigger value="prime">PRIME Truth</TabsTrigger>
          <TabsTrigger value="workers">Workers</TabsTrigger>
          <TabsTrigger value="agents">Agents & Commands</TabsTrigger>
        </TabsList>

        <TabsContent value="topology">
          <WorkflowGraph
            theme={theme}
            config={configHook.data}
            onSaveConfig={configHook.save}
          />
        </TabsContent>

        <TabsContent value="system-prompt" className="mt-4">
          <SystemPromptPipeline entries={SYSTEM_PROMPT_SECTIONS} />
        </TabsContent>

        <TabsContent value="prime" className="mt-4">
          <PromptEntryList entries={PRIME_TRUTH_ENTRIES} onFileOpen={setEditorPath} />
        </TabsContent>

        <TabsContent value="workers" className="mt-4">
          <PromptEntryList entries={WORKER_ENTRIES} onFileOpen={setEditorPath} />
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
    </>
  );
}
