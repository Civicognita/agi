/**
 * System Identity page — placeholder after agi-local-id absorption (Phase 4).
 *
 * OAuth connections, entity management, and federation identity are now
 * handled directly by the AGI gateway. Connection management is available
 * via Settings → Connections.
 */

import { PageScroll } from "@/components/PageScroll.js";

export default function IdentityServicePage() {
  return (
    <PageScroll>
      <div className="max-w-2xl mx-auto text-center space-y-4 py-12">
        <h1 className="text-xl font-semibold text-foreground">Identity</h1>
        <p className="text-subtext0">
          Identity management is built into the gateway. Manage OAuth connections
          and federation settings in{" "}
          <a href="/settings?tab=identity" className="underline text-blue">
            Settings → Identity
          </a>
          .
        </p>
      </div>
    </PageScroll>
  );
}
