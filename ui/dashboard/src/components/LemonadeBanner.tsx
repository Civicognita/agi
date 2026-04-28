/**
 * LemonadeBanner — first-run prompt to install the Lemonade local AI runtime.
 *
 * Hits `/api/lemonade/status` on mount. If the proxy returns 503 (Lemonade
 * not installed / not reachable), surfaces a banner pointing to the plugin
 * marketplace. Silent when Lemonade is up. Used on the HF Marketplace page
 * and inside the Onboarding ZeroMe (Mind chat) step so first-boot flows
 * see it without the owner having to hunt.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Cpu, AlertCircle } from "lucide-react";

interface LemonadeStatus {
  installed?: boolean;
  running?: boolean;
  version?: string;
  devices?: { amd_npu?: { available?: boolean } } | null;
}

type ProbeState =
  | { kind: "loading" }
  | { kind: "running"; npuPresent: boolean }
  | { kind: "absent"; npuPresent: boolean | "unknown" };

async function probeLemonade(): Promise<ProbeState> {
  try {
    const res = await fetch("/api/lemonade/status");
    if (!res.ok) {
      return { kind: "absent", npuPresent: "unknown" };
    }
    const data = (await res.json()) as LemonadeStatus;
    if (data.running) {
      const npuPresent = Boolean(data.devices?.amd_npu?.available);
      return { kind: "running", npuPresent };
    }
    return { kind: "absent", npuPresent: "unknown" };
  } catch {
    return { kind: "absent", npuPresent: "unknown" };
  }
}

export function LemonadeBanner({ context = "marketplace" }: { context?: "marketplace" | "onboarding" } = {}) {
  const [state, setState] = useState<ProbeState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void probeLemonade().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => { cancelled = true; };
  }, []);

  if (state.kind === "loading" || state.kind === "running") return null;

  // Lemonade not installed/running. Banner copy depends on whether the
  // owner has hardware that would benefit (NPU present elevates urgency).
  // Without Lemonade we can't probe NPU; the soft variant assumes nothing.
  const headline =
    context === "onboarding"
      ? "Install Lemonade before continuing"
      : "Local AI runtime not installed";

  const body =
    context === "onboarding"
      ? "Onboarding's chat step needs a local LLM. Install the Lemonade runtime to continue, or skip this step if you'll only use API providers."
      : "Install the Lemonade local LLM runtime to run models offline. Auto-detects AMD NPU + iGPU + CPU and serves an OpenAI-compatible API that AGI's router uses transparently.";

  return (
    <div className="mb-6 rounded-md border border-yellow/40 bg-yellow/10 p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 pt-0.5">
          {context === "onboarding" ? (
            <AlertCircle className="h-5 w-5 text-yellow" />
          ) : (
            <Cpu className="h-5 w-5 text-yellow" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground mb-1">{headline}</p>
          <p className="text-[13px] text-muted-foreground mb-3">{body}</p>
          <Link
            to="/gateway/marketplace"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-md border border-yellow/50 bg-yellow/20 text-foreground hover:bg-yellow/30 transition-colors"
          >
            Open Plugin Marketplace →
          </Link>
        </div>
      </div>
    </div>
  );
}
