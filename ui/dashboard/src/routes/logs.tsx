/**
 * Logs route — real-time log viewer.
 */

import { Logs } from "@/components/Logs.js";
import { useRootContext } from "./root.js";

export default function LogsPage() {
  const { logStream } = useRootContext();

  return (
    <Logs
      entries={logStream.entries}
      connected={logStream.connected}
      paused={logStream.paused}
      onClear={logStream.clear}
      onTogglePause={logStream.togglePause}
    />
  );
}
