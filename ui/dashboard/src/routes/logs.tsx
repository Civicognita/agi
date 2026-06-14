/**
 * Logs route — real-time log viewer.
 */

import { Logs } from "@/components/Logs.js";
import { useRootContext } from "./root.js";

export default function LogsPage() {
  const { logStream } = useRootContext();

  // Full-height layout — do NOT wrap in PageScroll. Logs manages its own
  // internal scroll (entries list is flex-1 overflow-y-auto). PageScroll
  // would create a double-scroll owner: the outer scroll moves the toolbar
  // off-screen while the inner scroll is also present. Use flex-1 pattern
  // (same as DocsPage / KnowledgePage) so main's flex-col constrains height.
  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      <Logs
        entries={logStream.entries}
        connected={logStream.connected}
        paused={logStream.paused}
        onClear={logStream.clear}
        onTogglePause={logStream.togglePause}
      />
    </div>
  );
}
