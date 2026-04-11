/**
 * Resources route — system resource monitoring (CPU, RAM, disk, uptime).
 */

import { ResourceUsage } from "@/components/ResourceUsage.js";
import { PageScroll } from "@/components/PageScroll.js";

export default function ResourcesPage() {
  return <PageScroll><ResourceUsage /></PageScroll>;
}
