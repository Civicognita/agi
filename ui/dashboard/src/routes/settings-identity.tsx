/**
 * Settings ▸ Identity — redirect shim (story #212).
 *
 * Identity Management was consolidated into the single System ▸ Identity page
 * (owner directive 2026-06-12: identity lives in ONE place, not duplicated in
 * Settings). This route now redirects there so any bookmarked /settings/identity
 * link keeps working.
 */

import { Navigate } from "react-router";

export default function SettingsIdentityPage() {
  return <Navigate to="/system/identity" replace />;
}
