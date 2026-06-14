/**
 * Root layout — sidebar navigation, slim top bar, chat flyout, theme, upgrade status.
 * Wraps all routes via <Outlet />.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate, useOutletContext } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { EditorFlyout } from "@/components/EditorFlyout.js";
import { TerminalFlyout } from "@/components/TerminalFlyout.js";
import { WhoDBFlyout } from "@/components/WhoDBFlyout.js";
import { UpgradeNextStepsPanel } from "@/components/UpgradeNextStepsPanel.js";
import { UpgradeWizard } from "@/components/UpgradeWizard.js";

import { cn, safeArray } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HearthTop } from "@/components/HearthTop.js";
import { ChatFlyout } from "@/components/ChatFlyout.js";
import { MagicAppModal } from "@/components/MagicAppModal.js";
import { MagicAppTray } from "@/components/MagicAppTray.js";
import { createInstanceManager } from "@/lib/magic-app-instances.js";
import { fetchMagicApps } from "@/api.js";
import type { MagicAppInfo, MagicAppInstance } from "@/types.js";
import { DnsSetupBanner } from "@/components/DnsSetupBanner.js";
import { SafemodeGuard } from "@/lib/safemode-guard.js";
import { ActivityDot } from "@/components/ActivityDot.js";
import { ActiveDownloads } from "@/components/ActiveDownloads.js";
import { ConnectionIndicator } from "@/components/ConnectionIndicator.js";
import { NotificationBell } from "@/components/NotificationBell.js";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover.js";
import { DevNotesIcon } from "@/components/ui/dev-notes.js";
import { RouteDevNotes } from "@/lib/route-notes.js";
import { ProfileCard } from "@/components/ProfileCard.js";
import { ProfileManager } from "@/components/ProfileManager.js";
import { useConfig, useDashboardWS, useHosting, useIsMobile, useLogStream, useOverview, useProjectConfigWS, useProjects } from "@/hooks.js";
import { useTheme } from "@/lib/theme-provider";
import { Chart, Icon, AccordionPanel, type SectionRenderState } from "@particle-academy/react-fancy";
import { checkForUpdates, startUpgrade, fetchUpgradeLog, fetchNotifications, markNotificationsRead, markAllNotificationsRead, executeProjectTool, fetchOnboardingState, fetchAuthStatus, fetchCurrentUser, fetchProviderBalances, fetchBalanceHistory } from "@/api.js";
import type { ProviderBalance } from "@/api.js";
import { LoginPage } from "@/components/LoginPage.js";
import type { ActivityEntry, DashboardEvent, Notification, ProjectActivity, TimeBucket, UpdateCheck } from "@/types.js";
import { resolveHelpContext } from "@/lib/help-context.js";

export type View = "overview" | "entity" | "coa" | "settings" | "logs" | "projects" | "system";

// ---------------------------------------------------------------------------
// Shell panel layout
// ---------------------------------------------------------------------------

// Shell panel semantics:
//   workspace = current AGI page (projects, settings, whatever the user is doing)
//   chat      = conversation with Aion
//   canvas    = Agent Canvas — where the agent works (plans, artifacts, iteration output)
type ShellPanelId = "workspace" | "chat" | "canvas";
const SHELL_PANELS: ShellPanelId[] = ["workspace", "chat", "canvas"];
const SHELL_ORDER_KEY = "aionima-shell-panel-order";
const DEFAULT_SHELL_ORDER: ShellPanelId[] = ["workspace", "chat", "canvas"];

interface ShellPanelHeaderProps {
  label: string;
  state: SectionRenderState;
  dragging: boolean;
  dragOver: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function ShellPanelHeader({ label, state, dragging, dragOver, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }: ShellPanelHeaderProps) {
  const { open, toggle } = state;

  // Collapsed state: full-height narrow strip with rotated label (also draggable)
  if (!open) {
    return (
      <button
        type="button"
        draggable
        onClick={toggle}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
        onDragEnd={onDragEnd}
        aria-label={`Expand ${label}`}
        aria-expanded={false}
        className={cn(
          "w-10 h-full flex flex-col items-center justify-center gap-3 select-none",
          "bg-surface0/60 hover:bg-secondary/40 transition-colors border-r border-border/40",
          "cursor-pointer",
          dragging && "opacity-50",
        )}
        data-testid={`shell-panel-header-${label.toLowerCase()}`}
      >
        {/* Expand affordance dots */}
        <svg className="w-2.5 h-2.5 text-muted-foreground/40" viewBox="0 0 6 10" fill="currentColor">
          <circle cx="2" cy="2" r="1" /><circle cx="4" cy="2" r="1" />
          <circle cx="2" cy="5" r="1" /><circle cx="4" cy="5" r="1" />
          <circle cx="2" cy="8" r="1" /><circle cx="4" cy="8" r="1" />
        </svg>
        <span className="text-[9px] tracking-[0.18em] uppercase font-semibold text-muted-foreground/60 [writing-mode:vertical-rl] [transform:rotate(180deg)]">
          {label}
        </span>
      </button>
    );
  }

  // Open state: horizontal header bar with grip + label + collapse button
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={onDragEnd}
      className={cn(
        "flex items-center gap-2 px-3 h-9 shrink-0 select-none",
        "border-b border-border bg-surface0/40 transition-colors",
        "cursor-grab active:cursor-grabbing",
        dragOver && "bg-primary/15 border-primary/40",
        dragging && "opacity-50",
      )}
      data-testid={`shell-panel-header-${label.toLowerCase()}`}
    >
      {/* 4-dot grip */}
      <svg className="w-3 h-3 shrink-0 text-muted-foreground/35 pointer-events-none" viewBox="0 0 8 8" fill="currentColor">
        <circle cx="2" cy="2" r="1" />
        <circle cx="6" cy="2" r="1" />
        <circle cx="2" cy="6" r="1" />
        <circle cx="6" cy="6" r="1" />
      </svg>
      <span className="flex-1 text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/70 pointer-events-none">
        {label}
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        aria-label={`Collapse ${label}`}
        aria-expanded={true}
        className="p-1 rounded text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary/30 transition-colors cursor-pointer"
        data-testid={`shell-panel-toggle-${label.toLowerCase()}`}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
    </div>
  );
}

/** Context shared with child routes via useOutletContext(). */
export interface RootContext {
  theme: "light" | "dark";
  overview: ReturnType<typeof useOverview>;
  configHook: ReturnType<typeof useConfig>;
  projectsHook: ReturnType<typeof useProjects>;
  hostingHook: ReturnType<typeof useHosting>;
  logStream: ReturnType<typeof useLogStream>;
  liveActivity: ActivityEntry[];
  projectActivity: Record<string, ProjectActivity | null>;
  timelineBucket: TimeBucket;
  setTimelineBucket: (b: TimeBucket) => void;
  onOpenChat: (context: string) => void;
  onOpenChatWithMessage: (context: string, message: string) => void;
  editorFilePath: string | null;
  onOpenEditor: (path: string) => void;
  onCloseEditor: () => void;
  onToolExecute: (projectPath: string, toolId: string) => Promise<{ ok: boolean; output?: string; error?: string }>;
  onOpenTerminal: (projectPath: string) => void;
  onRefreshMagicApps?: () => void;
  onOpenMagicApp?: (appId: string, projectPath: string) => Promise<void>;
  onOpenUpgradeWizard: () => void;
}


export default function RootLayout() {
  const { themeId, setTheme, themes } = useTheme();
  const currentTheme = themes.find((t) => t.id === themeId);
  const isDark = currentTheme?.dark ?? true;
  // Legacy compat: some child components accept theme="light"|"dark" prop
  const theme = isDark ? "dark" as const : "light" as const;
  const toggle = () => {
    // Cycle to the first theme with opposite dark mode
    const opposite = themes.find((t) => t.dark !== isDark);
    if (opposite) setTheme(opposite.id);
  };
  const queryClient = useQueryClient();
  const overviewHook = useOverview();
  const configHook = useConfig();
  const logStream = useLogStream();
  const projectsHook = useProjects();
  const hostingHook = useHosting();
  const contributingEnabled = Boolean(configHook.data?.dev?.enabled);

  const location = useLocation();
  const navigate = useNavigate();


  // FIRSTBOOT check — redirect to onboarding if not completed
  useEffect(() => {
    fetchOnboardingState()
      .then((state) => {
        if (!state.firstbootCompleted && location.pathname !== "/onboarding") {
          navigate("/onboarding", { replace: true });
        }
      })
      .catch(() => {
        // If API fails (e.g. server not ready), don't redirect
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isMobile = useIsMobile();
  const [timelineBucket, setTimelineBucket] = useState<TimeBucket>("day");
  const [liveActivity, setLiveActivity] = useState<ActivityEntry[]>([]);
  const [editorFilePath, setEditorFilePath] = useState<string | null>(null);
  const [projectActivity, setProjectActivity] = useState<Record<string, ProjectActivity | null>>({});

  // Shell panel layout state
  const [panelOrder, setPanelOrder] = useState<ShellPanelId[]>(() => {
    try {
      const stored = localStorage.getItem(SHELL_ORDER_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as unknown[];
        if (Array.isArray(parsed) && parsed.length === 3 && parsed.every((x) => SHELL_PANELS.includes(x as ShellPanelId))) {
          return parsed as ShellPanelId[];
        }
      }
    } catch { /* ignore */ }
    return DEFAULT_SHELL_ORDER;
  });
  // workspace + chat open by default; canvas starts collapsed (expands when agent produces something)
  const [shellOpen, setShellOpen] = useState<ShellPanelId[]>(["workspace", "chat"]);
  // Canvas section mount point — ChatFlyout portals AgentCanvas here
  const [canvasMountEl, setCanvasMountEl] = useState<Element | null>(null);
  const canvasMountRef = useCallback((el: Element | null) => { setCanvasMountEl(el); }, []);
  // Panel drag-to-reorder state
  const [draggingPanel, setDraggingPanel] = useState<ShellPanelId | null>(null);
  const [dragOverPanel, setDragOverPanel] = useState<ShellPanelId | null>(null);

  const handlePanelDrop = useCallback((targetId: ShellPanelId) => {
    setDragOverPanel(null);
    setDraggingPanel(null);
    if (!draggingPanel || draggingPanel === targetId) return;
    setPanelOrder((prev) => {
      const result = [...prev];
      const fromIdx = result.indexOf(draggingPanel);
      const toIdx = result.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      result.splice(fromIdx, 1);
      result.splice(toIdx, 0, draggingPanel);
      try { localStorage.setItem(SHELL_ORDER_KEY, JSON.stringify(result)); } catch { /* ignore */ }
      return result;
    });
  }, [draggingPanel]);
  const [chatContext, setChatContext] = useState<string | null>(null);
  const [chatInitialMessage, setChatInitialMessage] = useState<string | null>(null);
  const [chatRequestId, setChatRequestId] = useState<string | null>(null);
  const [systemActive, setSystemActive] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | null>(null);
  const [upgradedEvent, setUpgradedEvent] = useState<import("../types.js").SystemUpgradedEvent | null>(null);
  const [showUpgradePanel, setShowUpgradePanel] = useState(false);
  const [providerBalances, setProviderBalances] = useState<ProviderBalance[]>([]);
  const [balanceHistories, setBalanceHistories] = useState<Record<string, number[]>>({});
  const [upgradePhase, setUpgradePhase] = useState<string | null>(null);
  const [upgradeLogs, setUpgradeLogs] = useState<{ step: string; status: string; message: string; timestamp: string }[]>([]);
  const [upgradeReloading, setUpgradeReloading] = useState(false);
  const [upgradeWizardOpen, setUpgradeWizardOpen] = useState(false);
  const [profileManagerOpen, setProfileManagerOpen] = useState(false);
  const upgradePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for "open-profile-manager" custom events from settings/onboarding surfaces
  useEffect(() => {
    const handler = () => setProfileManagerOpen(true);
    window.addEventListener("open-profile-manager", handler);
    return () => window.removeEventListener("open-profile-manager", handler);
  }, []);

  // Auth gate state
  const [authChecked, setAuthChecked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ displayName: string; role: string } | null>(null);

  // AUTH gate — check if dashboard requires authentication
  useEffect(() => {
    const token = localStorage.getItem("aionima-dashboard-token");

    fetchAuthStatus()
      .then((status) => {
        if (!status.enabled) {
          // Auth not enabled — skip login
          setAuthChecked(true);
          setAuthenticated(true);
          return;
        }

        setAuthRequired(true);

        if (token) {
          // Validate existing token
          fetchCurrentUser(token)
            .then((data) => {
              setCurrentUser({ displayName: data.user.displayName, role: data.session.role });
              setAuthenticated(true);
              setAuthChecked(true);
            })
            .catch(() => {
              // Token invalid — clear it
              localStorage.removeItem("aionima-dashboard-token");
              setAuthChecked(true);
            });
        } else {
          setAuthChecked(true);
        }
      })
      .catch(() => {
        // If status API fails, allow access (server may not support auth yet)
        setAuthChecked(true);
        setAuthenticated(true);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Check for updates on mount + poll every 60s
  useEffect(() => {
    checkForUpdates().then(setUpdateCheck).catch(() => {});
    const interval = setInterval(() => {
      if (upgradePollRef.current !== null) return;
      checkForUpdates().then(setUpdateCheck).catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Fetch initial notifications on mount
  useEffect(() => {
    fetchNotifications({ limit: 50 })
      .then(({ notifications: items, unreadCount: count }) => {
        // Defensive: if the server returned a bad shape (e.g. an
        // un-awaited Promise that serialized as {}), coerce to an empty
        // array so the subsequent WS notification:new handler doesn't
        // crash with "_e is not iterable" on [event.data, ...prev].
        setNotifications(safeArray<Notification>(items));
        setUnreadCount(typeof count === "number" ? count : 0);
      })
      .catch(() => {});
  }, []);

  // Fetch provider balances on mount
  useEffect(() => {
    fetchProviderBalances().then(setProviderBalances).catch(() => {});
  }, []);

  // Fetch balance histories whenever providerBalances change
  useEffect(() => {
    const withBalance = providerBalances.filter(b => b.balance !== null);
    if (withBalance.length === 0) return;
    Promise.all(
      withBalance.map(async b => {
        const h = await fetchBalanceHistory(b.providerId);
        return { id: b.providerId, data: h.map(x => x.balance) };
      })
    ).then(results => {
      const h: Record<string, number[]> = {};
      for (const r of results) h[r.id] = r.data;
      setBalanceHistories(h);
    }).catch(() => {});
  }, [providerBalances]);

  // Recover upgrade log after page reload (e.g. post-restart).
  // If a recent upgrade happened, restore logs so the user sees the full history.
  useEffect(() => {
    fetchUpgradeLog().then((entries) => {
      const last = entries[entries.length - 1];
      if (!last) return;
      // Skip stale logs (older than 5 minutes)
      const lastTs = new Date(last.timestamp).getTime();
      if (Date.now() - lastTs > 5 * 60_000) return;

      const structured = entries
        .filter((e) => e.step && e.status)
        .map((e) => ({ step: e.step!, status: e.status!, message: e.message, timestamp: e.timestamp }));
      setUpgradeLogs(structured);

      const isComplete = last.step === "complete" && last.status === "done";
      const isError = last.phase === "error";
      if (isComplete) {
        setUpgradePhase("complete");
        setUpgradeWizardOpen(true);
        setTimeout(() => setUpgradePhase(null), 8000);
      } else if (isError) {
        setUpgradePhase("error");
        setUpgradeWizardOpen(true);
        setTimeout(() => setUpgradePhase(null), 8000);
      } else {
        // Upgrade still in progress — show it
        setUpgradePhase(last.phase);
        setUpgradeWizardOpen(true);
      }
    }).catch(() => {});
  }, []);

  const handleOpenChat = useCallback((context: string) => {
    setChatContext(context);
    // Chat is always visible in the shell — just update context
  }, []);

  // Context-aware chat: set project context when navigating into a project,
  // clear to workspace chat when navigating away. Chat stays open (chatOpen=true)
  // at all times — it's the primary UX surface.
  useEffect(() => {
    const m = location.pathname.match(/^\/projects\/([^/]+)/);
    if (m) {
      const slug = decodeURIComponent(m[1]);
      setChatContext(slug);
    } else {
      setChatContext(null);
    }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenChatWithMessage = useCallback((context: string, message: string) => {
    setChatContext(context);
    setChatInitialMessage(message);
    setChatRequestId(crypto.randomUUID());
  }, []);

  // s124 cycle 86 rework — handleOpenChatForIterativeWork removed. The
  // toast click-through is no longer needed because the artifact card now
  // renders INSIDE the project's chat flyout directly. Owners see the
  // artifact when they open that project's chat; no global toast →
  // chat-routing dispatch is required.

  const handleOpenEditor = useCallback((path: string) => {
    setEditorFilePath(path);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setEditorFilePath(null);
  }, []);


  const handleToolExecute = useCallback(async (projectPath: string, toolId: string) => {
    return executeProjectTool(projectPath, toolId);
  }, []);

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalProjectPath, setTerminalProjectPath] = useState<string | null>(null);
  const [whodbOpen, setWhodbOpen] = useState(false);

  // MagicApp instances — persistent floating/docked/minimized apps
  const [magicAppInstances, setMagicAppInstances] = useState<MagicAppInstance[]>([]);
  const [magicApps, setMagicApps] = useState<MagicAppInfo[]>([]);
  const [instanceMgr] = useState(() => createInstanceManager(setMagicAppInstances));

  // Load MagicApps + restore open instances on mount
  useEffect(() => {
    void fetchMagicApps().then(setMagicApps).catch(() => {});
    void instanceMgr.refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenTerminal = useCallback((projectPath: string) => {
    setTerminalProjectPath(projectPath);
    setTerminalOpen(true);
  }, []);

  // Notification handlers
  const handleMarkRead = useCallback((ids: string[]) => {
    markNotificationsRead(ids).catch(() => {});
    setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - ids.length));
  }, []);

  const handleMarkAllRead = useCallback(() => {
    markAllNotificationsRead().catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  // Real-time WebSocket updates
  const handleEvent = useCallback((event: DashboardEvent) => {
    if (event.type === "impact:recorded") {
      setLiveActivity((prev) => [event.data, ...prev].slice(0, 50));
    }
    if (event.type === "overview:updated") {
      void overviewHook.refresh();
    }
    if (event.type === "project:activity") {
      const { projectPath, type } = event.data;
      if (type === "invocation_start" || type === "tool_used") {
        setProjectActivity((prev) => ({ ...prev, [projectPath]: event.data }));
        setSystemActive(true);
        if (activityTimerRef.current !== null) clearTimeout(activityTimerRef.current);
        activityTimerRef.current = setTimeout(() => setSystemActive(false), 10_000);
      } else if (type === "invocation_complete") {
        setTimeout(() => {
          setProjectActivity((prev) => ({ ...prev, [projectPath]: null }));
        }, 2000);
        if (activityTimerRef.current !== null) clearTimeout(activityTimerRef.current);
        activityTimerRef.current = setTimeout(() => setSystemActive(false), 2000);
      }
    }
    if (event.type === "system:upgrade") {
      const { phase, step, status, message } = event.data;
      // Auto-open the dropdown so the user sees real-time progress
      setUpgradeWizardOpen(true);
      // Update the coarse UI phase (pulling → building → restarting → complete/error)
      if (phase === "error") {
        setUpgradePhase("error");
      } else if (phase !== "complete") {
        setUpgradePhase(phase);
      }
      // Accumulate structured log entries from upgrade.sh
      if (step && status) {
        setUpgradeLogs((prev) => [...prev, { step, status, message, timestamp: event.data.timestamp }]);
      }
    }
    if (event.type === "hosting:status") {
      void hostingHook.refresh();
      void projectsHook.refresh();
    }
    if (event.type === "tm:job_update") {
      const { status } = event.data;
      if (status === "running") {
        setSystemActive(true);
        if (activityTimerRef.current !== null) clearTimeout(activityTimerRef.current);
      } else if (status === "complete" || status === "failed") {
        if (activityTimerRef.current !== null) clearTimeout(activityTimerRef.current);
        activityTimerRef.current = setTimeout(() => setSystemActive(false), 2000);
      }
    }
    if (event.type === "tm:report_ready") {
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    }
    if (event.type === "system:update_available") {
      setUpdateCheck(event.data);
    }
    if (event.type === "system:upgraded") {
      setUpgradedEvent(event.data);
      setShowUpgradePanel(true);
    }
    if (event.type === "notification:new") {
      setNotifications((prev) => {
        // Belt-and-braces via safeArray: if a bad initial fetch planted
        // a non-array into state, don't crash the whole app — recover
        // with a clean list seeded from the new event.
        return [event.data, ...safeArray<Notification>(prev)].slice(0, 100);
      });
      setUnreadCount((prev) => (typeof prev === "number" ? prev : 0) + 1);
      // s124 cycle 86 rework: iterative-work completions now render INSIDE
      // the project's chat flyout (per-project surface) via ChatFlyout's
      // notifications prop + filter on activeSession.context. The previous
      // setLatestIterativeWorkToast / global toast stack is gone — the chat
      // surface IS the per-project surface.
    }
    if (event.type === "usage:recorded") {
      // Refresh provider balances after each completion so alerts stay current
      fetchProviderBalances().then(setProviderBalances).catch(() => {});
    }
  }, [overviewHook.refresh, hostingHook.refresh, projectsHook.refresh, queryClient]);

  useDashboardWS(handleEvent);
  useProjectConfigWS(); // Live cache invalidation for project config/container changes

  // Upgrade with log-based completion detection (replaces commit-based polling)
  const doUpgrade = useCallback(() => {
    setUpgradeWizardOpen(true);
    setUpgradePhase("pulling");
    setUpgradeLogs([]);

    startUpgrade().catch(() => {
      setUpgradePhase("error");
      setTimeout(() => setUpgradePhase(null), 5000);
    });

    // Poll the persisted upgrade log for completion.
    // The log survives server restarts — upgrade.sh writes .upgrade-pending before
    // restart, and the new server appends "complete" entries on boot.
    const poll = setInterval(() => {
      fetchUpgradeLog()
        .then((entries) => {
          const last = entries[entries.length - 1];
          if (!last) return;
          if (last.step === "complete" && last.status === "done") {
            clearInterval(poll);
            upgradePollRef.current = null;
            setUpgradePhase("complete");
            // Refresh update-check to get new commit info
            checkForUpdates().then((r) => setUpdateCheck(r)).catch(() => {});
            // Show reload overlay after a brief pause so user sees the "complete" entry.
            // No SW unregister needed — autoUpdate mode with skipWaiting + clientsClaim
            // activates the new SW immediately, and index.html is never precached so
            // navigations always hit the network for fresh asset references.
            setTimeout(() => {
              setUpgradeReloading(true);
              const tryReload = () => {
                fetch("/health", { cache: "no-store" })
                  .then((r) => { if (r.ok) window.location.reload(); else throw new Error("not ready"); })
                  .catch(() => { setTimeout(tryReload, 500); });
              };
              tryReload();
            }, 1500);
          } else if (last.phase === "error") {
            clearInterval(poll);
            upgradePollRef.current = null;
            setUpgradePhase("error");
            setTimeout(() => setUpgradePhase(null), 8000);
          }
        })
        .catch(() => {}); // Server may be down during restart — keep polling
    }, 2000);
    upgradePollRef.current = poll;

    // Safety timeout — 5 minutes
    setTimeout(() => {
      if (upgradePollRef.current === poll) {
        clearInterval(poll);
        upgradePollRef.current = null;
        setUpgradePhase("error");
        setTimeout(() => setUpgradePhase(null), 5000);
      }
    }, 5 * 60_000);
  }, []);

  // Show login page if auth is required and user is not authenticated
  if (authChecked && authRequired && !authenticated) {
    return (
      <LoginPage
        onLogin={(token) => {
          // Fetch user info for the header display
          fetchCurrentUser(token)
            .then((data) => setCurrentUser({ displayName: data.user.displayName, role: data.session.role }))
            .catch(() => {});
          setAuthenticated(true);
        }}
      />
    );
  }

  // Show nothing while checking auth
  if (!authChecked) {
    return null;
  }


  const ctx: RootContext = {
    theme,
    overview: overviewHook,
    configHook,
    projectsHook,
    hostingHook,
    logStream,
    liveActivity,
    projectActivity,
    timelineBucket,
    setTimelineBucket,
    onOpenChat: handleOpenChat,
    onOpenChatWithMessage: handleOpenChatWithMessage,
    editorFilePath,
    onOpenEditor: handleOpenEditor,
    onCloseEditor: handleCloseEditor,
    onToolExecute: handleToolExecute,
    onOpenTerminal: handleOpenTerminal,
    onRefreshMagicApps: () => { void instanceMgr.refresh(); },
    onOpenMagicApp: async (appId: string, projectPath: string) => {
      // Refresh MApp list to ensure newly installed apps are available for modal rendering
      await fetchMagicApps().then(setMagicApps).catch(() => {});
      await instanceMgr.openApp(appId, projectPath);
    },
    onOpenUpgradeWizard: () => setUpgradeWizardOpen(true),
  };

  return (
    <div className="h-screen bg-background text-foreground font-sans flex flex-col overflow-hidden">
      <SafemodeGuard />
      <HearthTop
        workspaces={[
          { name: "Home", color: "#10b981" },
          ...((configHook.data as { organization?: { name?: string } } | undefined)?.organization?.name
            ? [{ name: (configHook.data as { organization?: { name?: string } }).organization!.name!, color: "#6366f1" }]
            : []),
        ]}
        activeIndex={0}
        rightContent={
          <div className="flex gap-2 items-center">
            <ConnectionIndicator />
            {!isMobile && contributingEnabled && (
              <Badge className="text-xs bg-indigo-600 text-white">Contributing</Badge>
            )}
            {/* Multi-provider balance popover — shown when any provider has balance data */}
            {providerBalances.some(b => b.balance !== null) && (
              <Popover placement="bottom-end" offset={8}>
                <PopoverTrigger>
                  <button type="button" className="hidden sm:flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                    <span className="font-mono">
                      {(() => {
                        const warning = providerBalances.find(b => b.belowThreshold);
                        if (warning) return <span className="text-yellow-500">${warning.balance?.toFixed(2)}</span>;
                        return "Balances";
                      })()}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-4 bg-card border border-border rounded-xl shadow-lg z-[300]">
                  <div className="text-[12px] font-semibold text-foreground mb-3">Provider Balances</div>
                  {providerBalances.filter(b => b.balance !== null).map(b => (
                    <div key={b.providerId} className="flex items-center gap-3 py-2 border-b border-border last:border-b-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${b.belowThreshold ? "bg-red-500" : "bg-green-500"}`} />
                      <span className="text-[11px] flex-1 text-foreground">{b.providerName}</span>
                      {(balanceHistories[b.providerId]?.length ?? 0) > 1 && (
                        <Chart.Sparkline
                          data={balanceHistories[b.providerId]!}
                          width={60}
                          height={18}
                          color={b.belowThreshold ? "var(--color-red)" : "var(--color-green)"}
                        />
                      )}
                      <span className={`text-[11px] font-mono shrink-0 ${b.belowThreshold ? "text-red-500" : "text-foreground"}`}>
                        ${b.balance?.toFixed(2)}
                      </span>
                    </div>
                  ))}
                  {providerBalances.filter(b => b.balance !== null).length === 0 && (
                    <div className="text-[11px] text-muted-foreground">No balance data available</div>
                  )}
                </PopoverContent>
              </Popover>
            )}
            {/* Active downloads indicator */}
            <ActiveDownloads />
            {/* Upgrade wizard trigger — in-progress badge or "N updates" button */}
            {upgradePhase !== null && (
              <Badge
                data-testid="upgrade-wizard-trigger-progress"
                className={cn(
                  "text-xs cursor-pointer",
                  upgradePhase === "error"
                    ? "bg-red text-primary-foreground"
                    : "bg-primary text-primary-foreground",
                  upgradePhase !== "complete" && upgradePhase !== "error" && "animate-pulse",
                )}
                onClick={() => setUpgradeWizardOpen(true)}
              >
                {upgradePhase === "complete" ? "Upgraded!" : upgradePhase === "error" ? "Upgrade failed" : `${upgradePhase.charAt(0).toUpperCase() + upgradePhase.slice(1)}…`}
              </Badge>
            )}
            {upgradePhase === null && updateCheck?.updateAvailable && (
              <Button
                data-testid="upgrade-wizard-trigger-header"
                size="sm"
                onClick={() => setUpgradeWizardOpen(true)}
                className="rounded-xl"
              >
                {updateCheck.behindCount} update{updateCheck.behindCount !== 1 ? "s" : ""}
                {updateCheck.channel === "dev" && (
                  <span className="ml-1 text-[10px] opacity-70">(dev)</span>
                )}
              </Button>
            )}

            {/* System Terminal — host-level shell, distinct from the per-project
                container terminal that lives in the Development tab. */}
            <div className="hidden md:block">
              <button
                onClick={() => { setTerminalProjectPath(null); setTerminalOpen(true); }}
                className="p-2 rounded-lg hover:bg-surface0 text-subtext0 hover:text-text transition-colors"
                title="System Terminal"
                data-testid="system-terminal-button"
              >
                {/* s142 t558 — wrap SVG in PAx Icon for consistent a11y +
                    sizing. Icon provides aria-hidden=true + flex
                    centering; the inner svg keeps its viewBox + paths
                    until an icon set is registered upstream. */}
                <Icon size="md">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                </Icon>
              </button>
            </div>
            <div className="hidden md:block">
              <button
                onClick={() => setWhodbOpen(true)}
                className="p-2 rounded-lg hover:bg-surface0 text-subtext0 hover:text-text transition-colors"
                title="WhoDB"
                data-testid="whodb-button"
              >
                <Icon size="md">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M3 5V19A9 3 0 0 0 21 19V5" />
                    <path d="M3 12A9 3 0 0 0 21 12" />
                  </svg>
                </Icon>
              </button>
            </div>
            {/* DevNotes universal trigger (cycle 150 refactor). Opens the
                global modal with all currently-registered notes from the
                rendered page+tab+visible-views. Hidden when no notes exist
                or when Contributing/Dev Mode is off. */}
            <DevNotesIcon />
            {/* s137 t529 — universal help button. Opens chat with a help-mode
                context derived from the current pathname so the agent knows
                what page the user is looking at. The route → context mapping
                is the next slice (t530); for now the raw pathname suffices
                as the agent can read it. */}
            <button
              onClick={() => {
                setChatContext(`help:${resolveHelpContext(location.pathname)}`);
              }}
              className="p-2 rounded-lg transition-colors text-subtext0 hover:bg-surface0 hover:text-text"
              title="Get help with this page"
              data-testid="header-help-button"
              aria-label="Open help chat"
            >
              <Icon size="md">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </Icon>
            </button>
            {!isMobile && <ActivityDot active={systemActive} />}
            <NotificationBell
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={handleMarkRead}
              onMarkAllRead={handleMarkAllRead}
            />
            {!isMobile && (
              <Button variant="outline" size="sm" onClick={toggle}>
                {theme === "dark" ? "Light" : "Dark"}
              </Button>
            )}
            {/* User profile popover */}
            {(() => {
              const ownerName = configHook.data?.owner?.displayName ?? currentUser?.displayName;
              if (!ownerName) return null;
              const initial = ownerName.charAt(0).toUpperCase();
              return (
                <Popover placement="bottom-end" offset={8}>
                  <PopoverTrigger
                    className="pl-2 border-l border-border flex items-center gap-2 hover:opacity-80 transition-opacity"
                    data-testid="header-owner-avatar"
                  >
                    <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold cursor-pointer">
                      {initial}
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-auto border-0 bg-transparent shadow-none z-[300]">
                    <div className="flex flex-col">
                      <ProfileCard
                        displayName={ownerName}
                        channels={configHook.data?.owner?.channels}
                        dmPolicy={configHook.data?.owner?.dmPolicy}
                        showChannelIds
                      />
                      <button
                        onClick={() => setProfileManagerOpen(true)}
                        className="text-xs text-primary hover:underline px-4 py-2 text-left border-t border-border bg-card rounded-b-lg"
                      >
                        Manage People →
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              );
            })()}
          </div>
        }
      />

      {/* Content area — min-h-0 required so flex-1 is constrained to (100vh - header). */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">

        {/* DNS setup notice */}
        {hostingHook.status?.dnsmasq?.running && (
          <div className="max-w-[1200px] w-full mx-auto px-3 md:px-6 pt-4">
            <DnsSetupBanner baseDomain={hostingHook.status?.baseDomain ?? "ai.on"} />
          </div>
        )}

        {/* 3-panel shell: Workspace | Chat | Canvas.
            Workspace = current AGI page (projects, settings, whatever the user is doing).
            Chat      = conversation with Aion.
            Canvas    = Agent Canvas — where the agent works (plans, artifacts).
            AgentCanvas renders inside the Canvas section via a React portal from
            ChatFlyout so its state/WS events stay local to ChatFlyout's tree.
            Panel order is user-configurable (localStorage SHELL_ORDER_KEY).
            Canvas starts collapsed; workspace + chat open by default. */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-row" data-testid="hearth-layout">
          <AccordionPanel
            orientation={isMobile ? "vertical" : "horizontal"}
            value={shellOpen}
            onValueChange={(next) => {
              const typed = (next as string[]).filter(
                (id): id is ShellPanelId => SHELL_PANELS.includes(id as ShellPanelId),
              );
              setShellOpen(typed);
            }}
            className={cn("flex flex-1 w-full min-h-0", isMobile ? "flex-col" : "flex-row")}
          >
            {panelOrder.map((panelId) => {
              const isOpen = shellOpen.includes(panelId);
              // Open: flex-col (header on top, content below); closed: narrow strip
              const sectionClass = cn(
                "min-h-0 flex flex-col",
                isOpen ? "flex-1 min-w-0" : "w-10 shrink-0",
              );
              const label = panelId === "workspace" ? "Workspace" : panelId === "chat" ? "Chat" : "Canvas";
              const headerProps = {
                dragging: draggingPanel === panelId,
                dragOver: dragOverPanel === panelId,
                onDragStart: () => setDraggingPanel(panelId),
                onDragOver: () => setDragOverPanel(panelId),
                onDragLeave: () => setDragOverPanel(null),
                onDrop: () => handlePanelDrop(panelId),
                onDragEnd: () => { setDraggingPanel(null); setDragOverPanel(null); },
              };

              if (panelId === "workspace") {
                return (
                  <AccordionPanel.Section key="workspace" id="workspace" unstyled className={sectionClass}>
                    <AccordionPanel.Trigger>
                      {(state) => <ShellPanelHeader label={label} state={state} {...headerProps} />}
                    </AccordionPanel.Trigger>
                    <AccordionPanel.Content unstyled className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
                      <main className="flex-1 min-h-0 flex flex-col overflow-hidden" data-testid="hearth-canvas">
                        <RouteDevNotes />
                        {editorFilePath && (
                          <EditorFlyout
                            filePath={editorFilePath}
                            onClose={handleCloseEditor}
                            theme={theme}
                            position="left"
                          />
                        )}
                        <Outlet context={ctx} />
                      </main>
                    </AccordionPanel.Content>
                  </AccordionPanel.Section>
                );
              }

              if (panelId === "chat") {
                return (
                  <AccordionPanel.Section key="chat" id="chat" unstyled className={sectionClass}>
                    <AccordionPanel.Trigger>
                      {(state) => <ShellPanelHeader label={label} state={state} {...headerProps} />}
                    </AccordionPanel.Trigger>
                    <AccordionPanel.Content unstyled className="flex-1 min-h-0 min-w-0">
                      <ChatFlyout
                        open
                        onClose={() => { setChatInitialMessage(null); setChatRequestId(null); }}
                        theme={theme}
                        projects={projectsHook.projects}
                        openWithContext={chatContext}
                        openWithMessage={chatInitialMessage}
                        openRequestId={chatRequestId}
                        notifications={notifications}
                        docked
                        inShell
                        canvasPortalTarget={canvasMountEl}
                      />
                    </AccordionPanel.Content>
                  </AccordionPanel.Section>
                );
              }

              if (panelId === "canvas") {
                return (
                  <AccordionPanel.Section key="canvas" id="canvas" unstyled className={sectionClass}>
                    <AccordionPanel.Trigger>
                      {(state) => <ShellPanelHeader label={label} state={state} {...headerProps} />}
                    </AccordionPanel.Trigger>
                    <AccordionPanel.Content unstyled className="flex-1 min-h-0 min-w-0">
                      {/* AgentCanvas portalled here from ChatFlyout's React tree */}
                      <div ref={canvasMountRef} className="h-full w-full" />
                    </AccordionPanel.Content>
                  </AccordionPanel.Section>
                );
              }

              return null;
            })}
          </AccordionPanel>
        </div>
      </div>

      {/* Terminal flyout (bottom, overlay) */}
      <TerminalFlyout
        open={terminalOpen}
        onClose={() => { setTerminalOpen(false); setTerminalProjectPath(null); }}
        initialProjectPath={terminalProjectPath}
        projects={projectsHook.projects}
      />

      <WhoDBFlyout open={whodbOpen} onClose={() => setWhodbOpen(false)} />

      {/* Upgrade Wizard — full-page overlay for fork-aware 2-step upgrade */}
      <UpgradeWizard
        open={upgradeWizardOpen}
        onClose={() => setUpgradeWizardOpen(false)}
        upgradePhase={upgradePhase}
        upgradeLogs={upgradeLogs}
        upgradedEvent={upgradedEvent}
        showUpgradePanel={showUpgradePanel}
        onCloseUpgradePanel={() => { setShowUpgradePanel(false); setUpgradeWizardOpen(false); }}
        doUpgrade={doUpgrade}
      />

      {/* Standalone post-upgrade panel — shown when service restarts without wizard open */}
      {upgradedEvent && !upgradeWizardOpen && (
        <UpgradeNextStepsPanel
          open={showUpgradePanel}
          toVersion={upgradedEvent.toVersion}
          fromVersion={upgradedEvent.fromVersion}
          onClose={() => setShowUpgradePanel(false)}
        />
      )}

      {/* MagicApp floating/docked modals */}
      {magicAppInstances
        .filter((inst) => inst.mode !== "minimized")
        .map((inst) => {
          const app = magicApps.find((a) => a.id === inst.appId);
          if (!app) return null;
          return (
            <MagicAppModal
              key={inst.instanceId}
              app={app}
              instance={inst}
              onMinimize={() => void instanceMgr.minimizeApp(inst.instanceId)}
              onDock={() => void instanceMgr.setMode(inst.instanceId, "docked")}
              onFloat={() => void instanceMgr.setMode(inst.instanceId, "floating")}
              onMaximize={() => void instanceMgr.setMode(inst.instanceId, "maximized")}
              onClose={() => void instanceMgr.closeApp(inst.instanceId)}
              widgets={app.panel?.widgets}
              pages={app.pages}
              constants={app.constants}
            />
          );
        })}

      {/* MagicApp minimized tray (footer taskbar) */}
      <MagicAppTray
        instances={magicAppInstances}
        apps={magicApps}
        onRestore={(id) => void instanceMgr.restoreApp(id)}
        onClose={(id) => void instanceMgr.closeApp(id)}
      />

      {/* Full-page reload overlay — shown after upgrade completes */}
      {upgradeReloading && (
        <div className="fixed inset-0 z-[9999] bg-background/95 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <div className="text-lg font-semibold text-foreground">Applying update...</div>
            <div className="text-sm text-subtext0 mt-1">The dashboard will reload automatically.</div>
            {upgradeLogs.length > 0 && (
              <div className="mt-4 w-80 mx-auto bg-card border border-border rounded-lg p-3 max-h-[200px] overflow-y-auto text-left">
                {upgradeLogs.slice(-8).map((entry, i) => (
                  <div key={i} className="text-xs py-0.5 flex items-center gap-2">
                    <span className={cn(
                      "inline-block w-1.5 h-1.5 rounded-full shrink-0",
                      entry.status === "ok" ? "bg-green" :
                      entry.status === "fail" ? "bg-red" :
                      entry.status === "skip" ? "bg-yellow" :
                      "bg-blue",
                    )} />
                    <code className="text-subtext0">{entry.step}</code>
                    <span className={entry.status === "ok" ? "text-green" : "text-subtext1"}>{entry.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* s124 cycle 86 rework — iterative-work artifacts now render INSIDE
          the project's chat flyout (per-project surface), not as a global
          bottom-right toast stack. The IterativeWorkToastStack component
          is deprecated by this change; ChatFlyout consumes notifications
          directly + filters to its active session's project path. */}

      {/* Profile Manager flyout — triggered from header avatar popover */}
      <ProfileManager
        open={profileManagerOpen}
        onClose={() => setProfileManagerOpen(false)}
      />
    </div>
  );
}

/** Hook for child routes to access root context. */
export function useRootContext() {
  return useOutletContext<RootContext>();
}
