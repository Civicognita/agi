/**
 * Prompt Inspector — admin route that surfaces the assembled system prompt
 * Aion sees for a given RequestType, along with its token budget and
 * section count. Backend: POST /api/admin/prompt-preview.
 */

import { useCallback, useEffect, useState } from "react";
import { PageScroll } from "@/components/PageScroll.js";
import { fetchPromptPreview } from "@/api.js";
import type { PromptPreview, PromptPreviewRequestType } from "@/api.js";

const REQUEST_TYPES: PromptPreviewRequestType[] = [
  "chat",
  "project",
  "entity",
  "knowledge",
  "system",
  "worker",
  "taskmaster",
];

const REQUEST_TYPE_LABELS: Record<PromptPreviewRequestType, string> = {
  chat: "Chat",
  project: "Project",
  entity: "Entity",
  knowledge: "Knowledge",
  system: "System",
  worker: "Worker",
  taskmaster: "Taskmaster",
};

export default function PromptInspectorPage() {
  const [requestType, setRequestType] = useState<PromptPreviewRequestType>("chat");
  const [preview, setPreview] = useState<PromptPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((type: PromptPreviewRequestType) => {
    setLoading(true);
    setError(null);
    fetchPromptPreview(type)
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(requestType); }, [load, requestType]);

  return (
    <PageScroll>
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-[18px] font-semibold">Prompt Inspector</h1>
          <p className="text-[12px] text-muted-foreground">
            Inspect the assembled dynamic-context system prompt for each request type.
            Layers and sections come from <code>packages/gateway-core/src/system-prompt.ts</code>.
          </p>
        </header>

        <div className="flex items-center gap-3">
          <label className="text-[12px] text-muted-foreground" htmlFor="prompt-inspector-request-type">
            Request type
          </label>
          <select
            id="prompt-inspector-request-type"
            data-testid="prompt-inspector-request-type"
            className="text-[12px] bg-background border border-border rounded px-2 py-1"
            value={requestType}
            onChange={(e) => setRequestType(e.target.value as PromptPreviewRequestType)}
          >
            {REQUEST_TYPES.map((type) => (
              <option key={type} value={type}>
                {REQUEST_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        {error !== null ? (
          <div className="text-[12px] text-red py-2">Failed to load preview: {error}</div>
        ) : null}

        {loading && preview === null ? (
          <div className="text-[12px] text-muted-foreground py-8">Loading preview...</div>
        ) : null}

        {preview !== null ? (
          <>
            <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
              <span data-testid="prompt-inspector-token-estimate">
                ~<span className="text-foreground font-medium">{preview.tokenEstimate.toLocaleString()}</span> tokens
              </span>
              <span data-testid="prompt-inspector-section-count">
                <span className="text-foreground font-medium">{preview.sections}</span> sections
              </span>
              {loading ? <span className="text-[11px]">refreshing...</span> : null}
            </div>
            <pre
              data-testid="prompt-inspector-prompt"
              className="text-[11px] font-mono whitespace-pre-wrap bg-muted rounded p-3 border border-border"
            >
              {preview.prompt}
            </pre>
          </>
        ) : null}
      </div>
    </PageScroll>
  );
}
