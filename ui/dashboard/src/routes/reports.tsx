/**
 * Reports route — lists all worker reports.
 */

import { ReportList } from "@/components/ReportList.js";
import { PageScroll } from "@/components/PageScroll.js";

export default function ReportsPage() {
  return <PageScroll><ReportList /></PageScroll>;
}
