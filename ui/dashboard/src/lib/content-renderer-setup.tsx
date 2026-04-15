/**
 * ContentRenderer extensions — registered once at app boot.
 *
 * Adds support for custom inline tags that the agent (or any plugin) can emit
 * inside markdown / HTML content to get styled rendering without a per-plugin
 * component:
 *
 *   <thinking>...</thinking>   — collapsed "reasoning" panel (purple rail)
 *   <question>...</question>   — highlighted question / quiz block (blue rail)
 *   <callout>...</callout>     — warning / info banner (amber rail)
 *   <highlight>...</highlight> — inline highlight (cyan background)
 *
 * The react-fancy ContentRenderer invokes the registered component with
 * `{ content, attributes }` — `content` is the inner raw string, `attributes`
 * is a parsed map of HTML attributes from the opening tag. See
 * node_modules/@particle-academy/react-fancy/docs/ContentRenderer.md for the
 * full API.
 */

import { registerExtension, ContentRenderer } from "@particle-academy/react-fancy";
import { cn } from "@/lib/utils";

type ExtProps = { content: string; attributes?: Record<string, string> };

// ---------------------------------------------------------------------------
// <thinking> — collapsed reasoning panel
// ---------------------------------------------------------------------------
// Rendered collapsed by default so the agent's chain of thought doesn't flood
// the transcript. Users click to expand. Inner content is itself rendered as
// markdown so nested formatting works.

function ThinkingBlock({ content }: ExtProps) {
  // `open` by default — users prefer to see reasoning inline rather than
  // having to click to expand every turn. Clicking the summary still
  // collapses it when the reader wants to skim past.
  return (
    <details
      open
      className={cn(
        "my-2 rounded-lg border border-purple-500/30 bg-purple-500/5 overflow-hidden",
        "[&[open]>summary]:border-b [&[open]>summary]:border-purple-500/20",
      )}
    >
      <summary
        className={cn(
          "cursor-pointer select-none px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.15em]",
          "text-purple-400 flex items-center gap-2 list-none",
        )}
      >
        <span aria-hidden className="transition-transform [details[open]_&]:rotate-90">▶</span>
        <span>Thinking</span>
      </summary>
      <div className="px-3 py-2 text-[12px] text-muted-foreground leading-relaxed">
        <ContentRenderer value={content} format="markdown" />
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// <question> — highlighted question / quiz block
// ---------------------------------------------------------------------------
// The agent can offer quizzes, clarifying questions, or structured prompts.
// The opening tag may carry a `title` attribute used as the block heading.

function QuestionBlock({ content, attributes }: ExtProps) {
  const title = attributes?.title ?? "Question";
  return (
    <div className="my-3 rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-blue-400 mb-2 flex items-center gap-2">
        <span aria-hidden>ⓘ</span>
        <span>{title}</span>
      </div>
      <div className="text-[13px] text-foreground leading-relaxed">
        <ContentRenderer value={content} format="markdown" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// <callout> — warning / info banner
// ---------------------------------------------------------------------------
// `variant` attribute picks the tone: "warn" (amber, default), "info" (sky),
// "error" (red), "success" (emerald). The bar-left accent matches the tone.

function CalloutBlock({ content, attributes }: ExtProps) {
  const variant = (attributes?.variant ?? "warn") as "warn" | "info" | "error" | "success";
  const styles = {
    warn: "border-amber-500/40 bg-amber-500/5 text-amber-300",
    info: "border-sky-500/40 bg-sky-500/5 text-sky-300",
    error: "border-red-500/40 bg-red-500/5 text-red-300",
    success: "border-emerald-500/40 bg-emerald-500/5 text-emerald-300",
  }[variant];
  return (
    <div className={cn("my-3 rounded-lg border-l-4 border px-4 py-3 text-[12px] leading-relaxed", styles)}>
      <ContentRenderer value={content} format="markdown" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// <highlight> — inline highlight
// ---------------------------------------------------------------------------
// Inline (not block): renders as a span with a subtle cyan background so the
// agent can draw attention to a phrase within a paragraph.

function HighlightInline({ content }: ExtProps) {
  return (
    <span className="bg-cyan-500/15 text-cyan-200 px-1 py-0.5 rounded">{content}</span>
  );
}

// ---------------------------------------------------------------------------
// Setup — call once at app boot
// ---------------------------------------------------------------------------

let registered = false;

export function setupContentRendererExtensions(): void {
  if (registered) return;
  registered = true;

  registerExtension({ tag: "thinking", component: ThinkingBlock, block: true });
  registerExtension({ tag: "question", component: QuestionBlock, block: true });
  registerExtension({ tag: "callout", component: CalloutBlock, block: true });
  registerExtension({ tag: "highlight", component: HighlightInline, block: false });
}
