/**
 * Machine Admin route — wraps MachineAdmin component.
 */

import { MachineAdmin } from "@/components/MachineAdmin.js";
import { PageScroll } from "@/components/PageScroll.js";

export default function AdminPage() {
  return <PageScroll><MachineAdmin /></PageScroll>;
}
