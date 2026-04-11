/**
 * COA Explorer route — Chain of Achievement explorer.
 */

import { COAExplorer } from "@/components/COAExplorer.js";
import { PageScroll } from "@/components/PageScroll.js";

export default function COAPage() {
  return <PageScroll><COAExplorer /></PageScroll>;
}
