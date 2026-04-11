/**
 * Logs route — real-time log viewer.
 */

import { Logs } from "@/components/Logs.js";
import { PageScroll } from "@/components/PageScroll.js";
import { useRootContext } from "./root.js";

export default function LogsPage() {
  const { logStream } = useRootContext();

  return (
    <PageScroll>
    <Logs
      entries={logStream.entries}
      connected={logStream.connected}
      paused={logStream.paused}
      onClear={logStream.clear}
      onTogglePause={logStream.togglePause}
    />
    </PageScroll>
  );
}
