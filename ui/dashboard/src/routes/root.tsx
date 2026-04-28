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

import { cn, safeArray } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppSidebar } from "@/components/AppSidebar.js";
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
import { IterativeWorkToastStack } from "@/components/IterativeWorkToastStack.js";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover.js";
import { ProfileCard } from "@/components/ProfileCard.js";
import { useConfig, useDashboardWS, useHosting, useIsMobile, useLogStream, useOverview, useProjectConfigWS, useProjects } from "@/hooks.js";
import { useTheme } from "@/lib/theme-provider";
import { Chart } from "@particle-academy/react-fancy";
import { checkForUpdates, startUpgrade, fetchUpgradeLog, fetchNotifications, markNotificationsRead, markAllNotificationsRead, executeProjectTool, fetchOnboardingState, fetchAuthStatus, fetchCurrentUser, logoutDashboard, fetchProviderBalances, fetchBalanceHistory } from "@/api.js";
import type { ProviderBalance } from "@/api.js";
import { LoginPage } from "@/components/LoginPage.js";
import type { ActivityEntry, DashboardEvent, Notification, ProjectActivity, TimeBucket, UpdateCheck } from "@/types.js";

export type View = "overview" | "entity" | "coa" | "settings" | "logs" | "projects" | "system";

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
  workspaceMode: boolean;
  onOpenEditor: (path: string) => void;
  onCloseEditor: () => void;
  onToggleWorkspace: () => void;
  onToolExecute: (projectPath: string, toolId: string) => Promise<{ ok: boolean; output?: string; error?: string }>;
  onOpenTerminal: (projectPath: string) => void;
  onRefreshMagicApps?: () => void;
  onOpenMagicApp?: (appId: string, projectPath: string) => Promise<void>;
}

/** Map pathname prefix to page title. */
function getPageTitle(pathname: string): string {
  if (pathname === "/" || pathname === "") return "Overview";
  if (pathname === "/coa") return "COA Explorer";
  if (pathname.startsWith("/entity/")) return "Entity Profile";
  if (pathname.startsWith("/projects/") && pathname !== "/projects") return "Project Detail";
  if (pathname === "/projects") return "Projects";
  // Knowledge
  if (pathname === "/knowledge") return "Knowledge";
  // Gateway
  if (pathname === "/gateway/plugins") return "Plugins";
  if (pathname === "/gateway/workflows") return "Workflows";
  if (pathname === "/gateway/logs") return "Logs";
  if (pathname === "/gateway/marketplace") return "Marketplace";
  // Settings
  if (pathname.startsWith("/settings")) return "Settings";
  // System
  if (pathname === "/admin") return "Admin Dashboard";
  if (pathname === "/hf-marketplace") return "HF Models";
  if (pathname === "/system") return "Resources";
  if (pathname === "/system/services") return "Services";
  if (pathname === "/system/admin") return "Admin";
  if (pathname === "/system/changelog") return "Changelog";
  if (pathname === "/system/incidents") return "Incidents";
  if (pathname === "/system/vendors") return "Vendors";
  if (pathname === "/system/backups") return "Backups";
  if (pathname === "/settings/security") return "Security Settings";
  // Communication
  if (pathname === "/comms") return "Communications";
  if (pathname === "/comms/telegram") return "Telegram";
  if (pathname === "/comms/discord") return "Discord";
  if (pathname === "/comms/gmail") return "Gmail";
  if (pathname === "/comms/signal") return "Signal";
  if (pathname === "/comms/whatsapp") return "WhatsApp";
  // Reports
  if (pathname === "/reports") return "Reports";
  if (pathname.startsWith("/reports/")) return "Report Detail";
  return "Aionima";
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [timelineBucket, setTimelineBucket] = useState<TimeBucket>("day");
  const [liveActivity, setLiveActivity] = useState<ActivityEntry[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [editorFilePath, setEditorFilePath] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [projectActivity, setProjectActivity] = useState<Record<string, ProjectActivity | null>>({});
  const [chatContext, setChatContext] = useState<string | null>(null);
  const [chatInitialMessage, setChatInitialMessage] = useState<string | null>(null);
  const [chatRequestId, setChatRequestId] = useState<string | null>(null);
  const [systemActive, setSystemActive] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  // s124 t471 — most recent iterative-work notification, drives the toast
  // stack. The stack itself owns the active-toasts list + dismissal timers;
  // this state just bumps when a fresh `notification:new` event arrives.
  const [latestIterativeWorkToast, setLatestIterativeWorkToast] = useState<Notification | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | null>(null);
  const [providerBalances, setProviderBalances] = useState<ProviderBalance[]>([]);
  const [balanceHistories, setBalanceHistories] = useState<Record<string, number[]>>({});
  const [upgradePhase, setUpgradePhase] = useState<string | null>(null);
  const [upgradeLogs, setUpgradeLogs] = useState<{ step: string; status: string; message: string; timestamp: string }[]>([]);
  const [upgradeDropdown, setUpgradeDropdown] = useState(false);
  const [upgradeReloading, setUpgradeReloading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const upgradePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth gate state
  const [authChecked, setAuthChecked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [authProvider, setAuthProvider] = useState<"local-id" | "internal">("internal");
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

        setAuthProvider(status.provider ?? "internal");
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
      if (entries.length === 0) return;
      const last = entries[entries.length - 1];
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
        setUpgradeDropdown(true);
        setTimeout(() => setUpgradePhase(null), 8000);
      } else if (isError) {
        setUpgradePhase("error");
        setUpgradeDropdown(true);
        setTimeout(() => setUpgradePhase(null), 8000);
      } else {
        // Upgrade still in progress — show it
        setUpgradePhase(last.phase);
        setUpgradeDropdown(true);
      }
    }).catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!upgradeDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setUpgradeDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [upgradeDropdown]);

  const handleOpenChat = useCallback((context: string) => {
    setChatContext(context);
    setChatOpen(true);
  }, []);

  const handleOpenChatWithMessage = useCallback((context: string, message: string) => {
    setChatContext(context);
    setChatInitialMessage(message);
    setChatRequestId(crypto.randomUUID());
    setChatOpen(true);
  }, []);

  // s124 t472 — chat-routing for iterative-work toasts. Routes to the
  // project's chat using ChatFlyout's existing find-or-create logic
  // (matched by `session.context === projectPath`). The toast doesn't
  // need to know whether a session exists; ChatFlyout reuses if matched,
  // creates fresh otherwise. Seed-message-on-create lands as a follow-up
  // enhancement once t469 provides meaningful summary text in the
  // notification metadata; for now the chat opens empty when new.
  const handleOpenChatForIterativeWork = useCallback((notification: Notification) => {
    const meta = notification.metadata as { projectPath?: string; summary?: string } | null;
    const projectPath = meta?.projectPath;
    if (projectPath === undefined || projectPath.length === 0) return;
    // When the iteration produced a meaningful summary (t469-populated
    // path), seed the chat WITH the iteration context so a fresh session
    // starts with what the agent shipped. Existing sessions ignore the
    // seed via ChatFlyout's openWithMessage gate (existing path doesn't
    // consume the message). Empty summary → plain open without seed.
    if (meta?.summary !== undefined && meta.summary.length > 0) {
      handleOpenChatWithMessage(projectPath, `Reviewing iteration: ${meta.summary}`);
    } else {
      handleOpenChat(projectPath);
    }
  }, [handleOpenChat, handleOpenChatWithMessage]);

  const handleOpenEditor = useCallback((path: string) => {
    setEditorFilePath(path);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setEditorFilePath(null);
    setWorkspaceMode(false);
  }, []);

  const handleToggleWorkspace = useCallback(() => {
    setWorkspaceMode((p) => !p);
    setChatOpen(true);
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

  const handleLogout = useCallback(() => {
    logoutDashboard().then(() => {
      setAuthenticated(false);
      setCurrentUser(null);
    }).catch(() => {});
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
      setUpgradeDropdown(true);
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
    if (event.type === "notification:new") {
      setNotifications((prev) => {
        // Belt-and-braces via safeArray: if a bad initial fetch planted
        // a non-array into state, don't crash the whole app — recover
        // with a clean list seeded from the new event.
        return [event.data, ...safeArray<Notification>(prev)].slice(0, 100);
      });
      setUnreadCount((prev) => (typeof prev === "number" ? prev : 0) + 1);
      // s124 t471: surface iterative-work completions as toasts (other
      // notification types stay bell-only).
      if (event.data.type === "iterative-work") {
        setLatestIterativeWorkToast(event.data);
      }
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
    setUpgradeDropdown(true);
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
          if (entries.length === 0) return;
          const last = entries[entries.length - 1];
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
        provider={authProvider}
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

  const pageTitle = getPageTitle(location.pathname);

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
    workspaceMode,
    onOpenEditor: handleOpenEditor,
    onCloseEditor: handleCloseEditor,
    onToggleWorkspace: handleToggleWorkspace,
    onToolExecute: handleToolExecute,
    onOpenTerminal: handleOpenTerminal,
    onRefreshMagicApps: () => { void instanceMgr.refresh(); },
    onOpenMagicApp: async (appId: string, projectPath: string) => {
      // Refresh MApp list to ensure newly installed apps are available for modal rendering
      await fetchMagicApps().then(setMagicApps).catch(() => {});
      await instanceMgr.openApp(appId, projectPath);
    },
  };

  return (
    <div className="h-screen bg-background text-foreground font-sans flex overflow-hidden">
      <SafemodeGuard />
      {/* Sidebar */}
      <AppSidebar
        isMobile={isMobile}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        hfEnabled={Boolean((configHook.data as Record<string, unknown> | undefined)?.hf && ((configHook.data as Record<string, unknown>).hf as Record<string, unknown>)?.enabled)}
      />

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Slim top bar */}
        <header className="flex items-center justify-between px-3 md:px-6 py-2 md:py-3 bg-card border-b border-border sticky top-0 z-[100]">
          <div className="flex items-center gap-4">
            {isMobile && (
              <button
                onClick={() => setMobileNavOpen(true)}
                className="p-2 rounded-lg hover:bg-secondary text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Open navigation"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            <h1 className="text-base md:text-lg font-bold text-foreground">{pageTitle}</h1>
            {!isMobile && <ConnectionIndicator />}
          </div>
          <div className="flex gap-2 items-center">
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
                <PopoverContent className="w-[300px] p-4 bg-card border border-border rounded-xl shadow-lg z-[200]">
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
            {/* Upgrade status with step log */}
            {upgradePhase !== null && (
              <div className="relative" ref={upgradePhase !== "complete" && upgradePhase !== "error" ? dropdownRef : undefined}>
                <Badge
                  className={cn(
                    "text-xs cursor-pointer",
                    upgradePhase === "error"
                      ? "bg-red text-primary-foreground"
                      : "bg-primary text-primary-foreground",
                    upgradePhase !== "complete" && upgradePhase !== "error" && "animate-pulse",
                  )}
                  onClick={() => upgradeLogs.length > 0 && setUpgradeDropdown((p) => !p)}
                >
                  {upgradePhase === "complete" ? "Upgraded!" : upgradePhase === "error" ? "Upgrade failed" : `${upgradePhase.charAt(0).toUpperCase() + upgradePhase.slice(1)}...`}
                  {upgradeLogs.length > 0 && <span className="ml-1 opacity-70">({upgradeLogs.length})</span>}
                </Badge>
                {upgradeDropdown && upgradeLogs.length > 0 && upgradePhase !== "complete" && !upgradeReloading && (
                  <div className="absolute top-[calc(100%+8px)] right-0 w-[min(384px,calc(100vw-24px))] bg-card border border-border rounded-xl p-3 z-[200] shadow-lg max-h-[300px] overflow-y-auto">
                    <div className="text-[13px] font-semibold mb-2">Deploy Log</div>
                    {upgradeLogs.map((entry, i) => (
                      <div key={i} className="text-xs py-1 border-b border-border flex items-center gap-2">
                        <span className={cn(
                          "inline-block w-2 h-2 rounded-full shrink-0",
                          entry.status === "ok" ? "bg-green" :
                          entry.status === "fail" ? "bg-red" :
                          entry.status === "skip" ? "bg-yellow" :
                          "bg-blue animate-pulse",
                        )} />
                        <code className="text-subtext0">{entry.step}</code>
                        <span className="text-subtext1 truncate">{entry.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Updates available badge */}
            {upgradePhase === null && updateCheck?.updateAvailable && (
              <div ref={dropdownRef} className="relative">
                <Button
                  size="sm"
                  onClick={() => setUpgradeDropdown((p) => !p)}
                  className="rounded-xl"
                >
                  {updateCheck.behindCount} update{updateCheck.behindCount !== 1 ? "s" : ""}
                  {updateCheck.channel === "dev" && (
                    <span className="ml-1 text-[10px] opacity-70">(dev)</span>
                  )}
                </Button>
                {upgradeDropdown && (
                  <div className="absolute top-[calc(100%+8px)] right-0 w-[min(320px,calc(100vw-24px))] bg-card border border-border rounded-xl p-4 z-[200] shadow-lg">
                    <div className="text-[13px] font-semibold mb-2">
                      Pending commits{updateCheck.channel === "dev" ? " (dev)" : ""}
                    </div>
                    <div className="max-h-[200px] overflow-y-auto mb-3">
                      {updateCheck.commits.map((c) => (
                        <div key={c.hash} className="text-xs py-1 border-b border-border">
                          <code className="text-blue mr-1.5">{c.hash.slice(0, 7)}</code>
                          {c.message}
                        </div>
                      ))}
                    </div>
                    <Button className="w-full" onClick={doUpgrade}>
                      Upgrade Now
                    </Button>
                  </div>
                )}
              </div>
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
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </button>
            </div>
            <div className="hidden md:block">
              <button
                onClick={() => setWhodbOpen(true)}
                className="p-2 rounded-lg hover:bg-surface0 text-subtext0 hover:text-text transition-colors"
                title="WhoDB"
                data-testid="whodb-button"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M3 5V19A9 3 0 0 0 21 19V5" />
                  <path d="M3 12A9 3 0 0 0 21 12" />
                </svg>
              </button>
            </div>
            <button
              onClick={() => setChatOpen((p) => !p)}
              className={cn(
                "p-2 rounded-lg transition-colors",
                chatOpen
                  ? "bg-primary text-primary-foreground"
                  : "text-subtext0 hover:bg-surface0 hover:text-text",
              )}
              title="Chat"
              data-testid="header-chat-button"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </button>
            {!isMobile && <ActivityDot active={systemActive} />}
            <NotificationBell
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={handleMarkRead}
              onMarkAllRead={handleMarkAllRead}
            />
            {!isMobile && editorFilePath && (
              <Button variant="outline" size="sm" onClick={handleToggleWorkspace}>
                {workspaceMode ? "Exit Workspace" : "Edit | Chat"}
              </Button>
            )}
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
                  <PopoverContent className="p-0 w-auto border-0 bg-transparent shadow-none z-[200]">
                    <ProfileCard
                      displayName={ownerName}
                      channels={configHook.data?.owner?.channels}
                      dmPolicy={configHook.data?.owner?.dmPolicy}
                      showChannelIds
                    />
                  </PopoverContent>
                </Popover>
              );
            })()}
          </div>
        </header>

        {/* DNS setup notice */}
        {hostingHook.status?.dnsmasq?.running && (
          <div className="max-w-[1200px] w-full mx-auto px-3 md:px-6 pt-4">
            <DnsSetupBanner baseDomain={hostingHook.status?.baseDomain ?? "ai.on"} />
          </div>
        )}

        {workspaceMode && editorFilePath ? (
          // Workspace mode: editor + chat side by side, sticky below header
          <div className="flex flex-1 min-h-0">
            <EditorFlyout
              filePath={editorFilePath}
              onClose={handleCloseEditor}
              theme={theme}
              docked
            />
            <ChatFlyout
              open={chatOpen}
              onClose={() => { setChatOpen(false); setChatContext(null); setChatInitialMessage(null); setChatRequestId(null); }}
              theme={theme}
              projects={projectsHook.projects}
              openWithContext={chatContext}
              openWithMessage={chatInitialMessage}
              openRequestId={chatRequestId}
              docked
            />
          </div>
        ) : (
          // Normal mode: content area with flyout overlays
          <>
            <main className="max-w-[1200px] w-full mx-auto flex-1 min-h-0 flex flex-col overflow-hidden">
              <Outlet context={ctx} />
            </main>

            {/* Editor flyout (left side, overlay) */}
            {editorFilePath && (
              <EditorFlyout
                filePath={editorFilePath}
                onClose={handleCloseEditor}
                theme={theme}
                position="left"
              />
            )}

            {/* Chat flyout (right side, overlay) */}
            <ChatFlyout
              open={chatOpen}
              onClose={() => { setChatOpen(false); setChatContext(null); setChatInitialMessage(null); setChatRequestId(null); }}
              theme={theme}
              projects={projectsHook.projects}
              openWithContext={chatContext}
              openWithMessage={chatInitialMessage}
              openRequestId={chatRequestId}
            />
          </>
        )}
      </div>

      {/* Terminal flyout (bottom, overlay) */}
      <TerminalFlyout
        open={terminalOpen}
        onClose={() => { setTerminalOpen(false); setTerminalProjectPath(null); }}
        initialProjectPath={terminalProjectPath}
        projects={projectsHook.projects}
      />

      <WhoDBFlyout open={whodbOpen} onClose={() => setWhodbOpen(false)} />

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

      {/* s124 t471 — iterative-work toast stack (bottom-right, fixed).
          Subscribes to the same notification:new WS stream as the bell;
          only renders entries with type === "iterative-work". Click-through
          (s124 t472) routes to the project's chat via find-or-create. */}
      <IterativeWorkToastStack
        latest={latestIterativeWorkToast}
        onActivate={handleOpenChatForIterativeWork}
      />
    </div>
  );
}

/** Hook for child routes to access root context. */
export function useRootContext() {
  return useOutletContext<RootContext>();
}
