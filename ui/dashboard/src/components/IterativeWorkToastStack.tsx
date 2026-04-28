/**
 * IterativeWorkToastStack — bottom-right stacked container for active
 * iterative-work toasts (s124 t471).
 *
 * Sits in the dashboard layout root (RootLayout) so it follows the user
 * across routes. Subscribes to the same notification:new WS stream as the
 * NotificationBell, but only renders entries whose `type` is "iterative-work".
 *
 * Behavior:
 *   - Stacks up to MAX_ACTIVE toasts vertically (newest on top); older
 *     toasts fall off when capacity is exceeded.
 *   - Each toast auto-dismisses after AUTO_DISMISS_MS unless dismissed
 *     manually.
 *   - Click-through navigates to /projects/<slug> for now (t472 will route
 *     to chat).
 *   - Position pinned bottom-right; matches the existing Toast.Provider
 *     position so the two surfaces don't overlap (the regular Toast.Provider
 *     uses bottom-right too, but its toasts are short-lived and stack ABOVE
 *     ours via z-index ordering).
 *
 * Why the stack manager is a separate component: keeps `IterativeWorkToast`
 * pure-render (no state), which makes it trivial to unit test and snapshot.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { IterativeWorkToast } from "./IterativeWorkToast.js";
import type { Notification } from "@/types.js";

const MAX_ACTIVE = 3;
const AUTO_DISMISS_MS = 8_000;

interface IterativeWorkToastStackProps {
  /** Latest iterative-work notification to surface. Parent (RootLayout) bumps
   *  this whenever a new notification:new event arrives with type==="iterative-work".
   *  null when no fresh notification has arrived yet. */
  latest: Notification | null;
}

/** Derive the project slug from an absolute project path so we can
 *  navigate via React Router (`/projects/<slug>`). Mirrors what the
 *  ProjectsHook expects when the user clicks a tile. Falls back to the
 *  last path segment when the metadata isn't shaped as expected. */
function deriveProjectSlug(notification: Notification): string | null {
  const meta = notification.metadata as { projectPath?: string } | null;
  const projectPath = meta?.projectPath;
  if (projectPath === undefined || projectPath.length === 0) return null;
  const segments = projectPath.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? null;
}

export function IterativeWorkToastStack({ latest }: IterativeWorkToastStackProps) {
  const [active, setActive] = useState<Notification[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const navigate = useNavigate();

  // Push the latest notification into the stack (deduplicated by id).
  useEffect(() => {
    if (latest === null) return;
    if (seenIds.current.has(latest.id)) return;
    seenIds.current.add(latest.id);

    setActive((prev) => {
      const next = [latest, ...prev];
      return next.length > MAX_ACTIVE ? next.slice(0, MAX_ACTIVE) : next;
    });

    // Auto-dismiss after the configured TTL. Uses an explicit setTimeout
    // rather than rendering with a CSS animation so the React state stays
    // canonical (one source of truth = `active`).
    const timer = window.setTimeout(() => {
      setActive((prev) => prev.filter((n) => n.id !== latest.id));
    }, AUTO_DISMISS_MS);
    return () => { window.clearTimeout(timer); };
  }, [latest]);

  const dismiss = (id: string): void => {
    setActive((prev) => prev.filter((n) => n.id !== id));
  };

  const handleClick = (notification: Notification): void => {
    const slug = deriveProjectSlug(notification);
    if (slug !== null) {
      // Navigate first so the user lands on the project; t472 will replace
      // this with chat-routing (open existing chat for project or create
      // new with seed message).
      navigate(`/projects/${slug}`);
    }
    dismiss(notification.id);
  };

  if (active.length === 0) return null;

  return (
    <div
      data-testid="iterative-work-toast-stack"
      className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 pointer-events-none"
      role="region"
      aria-label="Iterative work notifications"
    >
      {active.map((n) => (
        <div key={n.id} className="pointer-events-auto">
          <IterativeWorkToast
            notification={n}
            onDismiss={() => { dismiss(n.id); }}
            onClick={() => { handleClick(n); }}
          />
        </div>
      ))}
    </div>
  );
}
