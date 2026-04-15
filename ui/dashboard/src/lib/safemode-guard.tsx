/**
 * SafemodeGuard — when the gateway is in safemode, force all routes to /admin
 * so the user sees the crash callout and can run recovery. Mounted once at
 * the root layout level.
 */

import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useSafemode } from "@/hooks";

/** Routes that are allowed while safemode is active. */
const ALLOWED_PATHS = ["/admin"];

function isAllowed(pathname: string): boolean {
  return ALLOWED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function SafemodeGuard() {
  const { data: snap } = useSafemode();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (snap === undefined || !snap.active) return;
    if (isAllowed(location.pathname)) return;
    navigate("/admin", { replace: true });
  }, [snap, location.pathname, navigate]);

  return null;
}
