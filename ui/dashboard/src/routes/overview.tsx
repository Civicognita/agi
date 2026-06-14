/**
 * Overview route — Hearth calm home (s197).
 *
 * Replaced the two-tab Usage & Cost / Impactinomics layout with the
 * HearthHome centered-chat + NeedsYouDrawer design. The old tab content
 * is accessible from other routes and the WorkspaceChip nav.
 *
 * DevNotes: Usage & Cost → dedicated /usage route (future s2xx).
 *            Impactinomics remains under ComingSoonOverlay until 0PRIME/MINT.
 */

import { HearthHome } from "@/components/HearthHome.js";

export default function OverviewPage() {
  return <HearthHome />;
}
