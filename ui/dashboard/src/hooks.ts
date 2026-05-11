/**
 * Dashboard React Hooks — TanStack Query for data fetching, WebSocket for real-time.
 *
 * Data-fetching hooks use TanStack Query (useQuery/useMutation).
 * WebSocket hooks (useDashboardWS, useChat, useLogStream) remain manual
 * but invalidate query cache on events.
 * useTheme is localStorage-only, no API.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { DashboardEvent, LogEntry, AionimaConfig, HFModelSearchResult, CoreForkStatus } from "./types.js";
import {
  fetchOverview, fetchConfig, saveConfig,
  fetchProjects, createProject, updateProject, deleteProject,
  fetchPlans,
  fetchHostingStatus,
  enableHosting, disableHosting, configureHosting, restartHosting,
  enableTunnel, disableTunnel,
  fetchContainerLogs,
  fetchSystemStats,
  fetchMachineInfo, setMachineHostname,
  fetchLinuxUsers, createLinuxUser, updateLinuxUser, deleteLinuxUser,
  fetchAgents, restartAgent,
  fetchReports, fetchReport,
  fetchHFHardwareProfile,
  searchHFModels,
  fetchHFInstalledModels,
  fetchHFRunningModels,
  fetchHFContainerStats,
  searchHFDatasets,
  fetchHFInstalledDatasets,
  listFineTuneJobs,
  getFineTuneStatus,
} from "./api.js";

// ---------------------------------------------------------------------------
// useOverview — TanStack Query with auto-refresh
// ---------------------------------------------------------------------------

export function useOverview(windowDays = 90) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["dashboard", "overview", windowDays],
    queryFn: () => fetchOverview(windowDays),
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["dashboard", "overview"] });
  }, [queryClient]);

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refresh,
  };
}

// ---------------------------------------------------------------------------
// Version-mismatch auto-reload
//
// Called on every WS reconnect. If /health's `version` field differs from
// the value Vite baked into this bundle at build time (__AGI_VERSION__),
// the server has been upgraded and this tab is running stale JS. Reload
// before the stale code hits an API response it can't parse.
// ---------------------------------------------------------------------------
let versionReloadScheduled = false;
async function checkVersionAndReload(): Promise<void> {
  if (versionReloadScheduled) return;
  try {
    const res = await fetch("/health", { cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as { version?: string };
    const serverVersion = body.version;
    if (!serverVersion || serverVersion === "unknown") return;
    if (serverVersion === __AGI_VERSION__) return;
    versionReloadScheduled = true;
    // Defer slightly so any in-flight saves can settle.
    setTimeout(() => { window.location.reload(); }, 300);
  } catch {
    // Network hiccup — skip this round, we'll try again on the next
    // reconnect.
  }
}

// ---------------------------------------------------------------------------
// useDashboardWS — WebSocket subscription (invalidates queries on events)
// ---------------------------------------------------------------------------

export function useDashboardWS(
  onEvent: (event: DashboardEvent) => void,
  entityIds?: string[],
  channels?: string[],
) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const cancelledRef = useRef(false);
  onEventRef.current = onEvent;

  useEffect(() => {
    cancelledRef.current = false;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    function connect() {
      if (cancelledRef.current) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        const subscription = {
          type: "dashboard:subscribe",
          entityIds: entityIds ?? [],
          channels: channels ?? [],
        };
        ws.send(JSON.stringify(subscription));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as { type: string; payload?: unknown };
          if (msg.type === "dashboard_event" && msg.payload !== undefined) {
            onEventRef.current(msg.payload as DashboardEvent);
          } else if (msg.type === "config_reloaded" && msg.payload !== undefined) {
            onEventRef.current({ type: "config:changed", data: msg.payload } as DashboardEvent);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onerror = () => {
        // Will trigger onclose -> reconnect
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!cancelledRef.current) {
          // After a reconnect, the gateway may have restarted on a new
          // version. If /health reports a different version than this
          // tab's build, the JS we have is stale — force a full reload
          // to avoid "TypeError: _e is not iterable" crashes from
          // shape drift. Runs lazily so the WS reconnect isn't blocked.
          void checkVersionAndReload();
          setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return () => {
      cancelledRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [entityIds, channels]);
}

// ---------------------------------------------------------------------------
// useProjectConfigWS — Bridges WS events to TanStack Query cache invalidation.
// Call once at the dashboard layout level.
// ---------------------------------------------------------------------------

export function useProjectConfigWS() {
  const queryClient = useQueryClient();

  useDashboardWS(
    useCallback((event: DashboardEvent) => {
      switch (event.type) {
        case "project:config_changed":
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
          void queryClient.invalidateQueries({ queryKey: ["hosting", "status"] });
          break;
        case "project:container_status":
          void queryClient.invalidateQueries({ queryKey: ["hosting", "status"] });
          break;
        case "hosting:status":
          void queryClient.invalidateQueries({ queryKey: ["hosting"] });
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
          break;
        case "config:changed":
          void queryClient.invalidateQueries({ queryKey: ["config"] });
          break;
        case "dev:core-fork-updated":
          void queryClient.invalidateQueries({ queryKey: ["dev", "core-forks", "status"] });
          break;
      }
    }, [queryClient]),
  );
}

// ---------------------------------------------------------------------------
// useCoreForkStatus — ahead/behind vs upstream for all five core forks
// ---------------------------------------------------------------------------

export function useCoreForkStatus() {
  return useQuery({
    queryKey: ["dev", "core-forks", "status"],
    queryFn: async (): Promise<{ forks: CoreForkStatus[]; branch?: string; error?: string }> => {
      const res = await fetch("/api/dev/core-forks/status");
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
      return (await res.json()) as { forks: CoreForkStatus[]; branch?: string; error?: string };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

// ---------------------------------------------------------------------------
// useConfig — TanStack Query + mutation
// ---------------------------------------------------------------------------

export function useConfig() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["config"],
    queryFn: fetchConfig,
  });

  const mutation = useMutation({
    mutationFn: saveConfig,
    onSuccess: (_result, variables) => {
      queryClient.setQueryData(["config"], variables);
    },
  });

  const save = useCallback(async (config: AionimaConfig) => {
    await mutation.mutateAsync(config);
  }, [mutation]);

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    saving: mutation.isPending,
    saveMessage: mutation.data?.message ?? (mutation.error?.message ?? null),
    refresh: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
    save,
  };
}

// ---------------------------------------------------------------------------
// useProjects — TanStack Query + mutations
// ---------------------------------------------------------------------------

export function useProjects() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
  });

  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateProject,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const create = useCallback(async (params: { name: string; tynnToken?: string; repoRemote?: string; category?: string; type?: string; stacks?: string[] }) => {
    return createMutation.mutateAsync(params);
  }, [createMutation]);

  const update = useCallback(async (params: { path: string; name?: string; tynnToken?: string | null; category?: string }) => {
    await updateMutation.mutateAsync(params);
  }, [updateMutation]);

  const remove = useCallback(async (params: { path: string; confirm: boolean }) => {
    await deleteMutation.mutateAsync(params);
  }, [deleteMutation]);

  return {
    projects: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? createMutation.error?.message ?? updateMutation.error?.message ?? deleteMutation.error?.message ?? null,
    creating: createMutation.isPending,
    updating: updateMutation.isPending,
    deleting: deleteMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
    create,
    update,
    remove,
  };
}

// ---------------------------------------------------------------------------
// useTheme — dark/light mode (localStorage only)
// ---------------------------------------------------------------------------
// useTheme is now in lib/theme-provider.tsx — import from there.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// useChat — chat with Aionima via WebSocket
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "chat:history" }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; payload?: unknown };

        switch (msg.type) {
          case "chat:history": {
            const payload = msg.payload as { messages?: ChatMessage[] };
            if (payload.messages) setMessages(payload.messages);
            break;
          }
          case "chat:thinking":
            setThinking(true);
            setError(null);
            break;
          case "chat:response": {
            const payload = msg.payload as { text: string; timestamp: string };
            setThinking(false);
            setMessages((prev) => [...prev, { role: "assistant", content: payload.text, timestamp: payload.timestamp }]);
            break;
          }
          case "chat:error": {
            const payload = msg.payload as { error: string };
            setThinking(false);
            setError(payload.error);
            break;
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        reconnectTimer.current = setTimeout(() => {
          if (wsRef.current === ws || wsRef.current === null) connect();
        }, 3000);
      }
    };

    ws.onerror = () => {
      // Will trigger onclose → reconnect
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const send = useCallback((text: string) => {
    if (!text.trim()) return;
    const timestamp = new Date().toISOString();
    setMessages((prev) => [...prev, { role: "user", content: text, timestamp }]);
    setError(null);
    wsRef.current?.send(JSON.stringify({ type: "chat:send", payload: { text } }));
  }, []);

  return useMemo(() => ({ messages, send, thinking, error }), [messages, send, thinking, error]);
}

// ---------------------------------------------------------------------------
// useLogStream — real-time log streaming via WebSocket
// ---------------------------------------------------------------------------

const MAX_LOG_ENTRIES = 1000;

export function useLogStream() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "log:subscribe" }));
    };

    ws.onmessage = (event) => {
      if (pausedRef.current) return;
      try {
        const msg = JSON.parse(event.data as string) as { type: string; payload?: unknown };

        if (msg.type === "log:history") {
          const history = msg.payload as LogEntry[];
          setEntries(history.slice(-MAX_LOG_ENTRIES));
        } else if (msg.type === "log:entry") {
          const entry = msg.payload as LogEntry;
          setEntries((prev) => {
            const next = [...prev, entry];
            return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
          });
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (wsRef.current === ws) {
        reconnectTimer.current = setTimeout(() => {
          if (wsRef.current === ws || wsRef.current === null) connect();
        }, 3000);
      }
    };

    ws.onerror = () => {
      // Will trigger onclose → reconnect
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const clear = useCallback(() => setEntries([]), []);

  const togglePause = useCallback(() => {
    setPaused((p) => {
      const next = !p;
      if (next) {
        wsRef.current?.send(JSON.stringify({ type: "log:unsubscribe" }));
      } else {
        wsRef.current?.send(JSON.stringify({ type: "log:subscribe" }));
      }
      return next;
    });
  }, []);

  return useMemo(
    () => ({ entries, connected, paused, clear, togglePause }),
    [entries, connected, paused, clear, togglePause],
  );
}

// ---------------------------------------------------------------------------
// usePlans — TanStack Query
// ---------------------------------------------------------------------------

export function usePlans(projectPath: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["plans", projectPath],
    queryFn: () => fetchPlans(projectPath!),
    enabled: projectPath !== null,
  });

  return {
    plans: query.data ?? [],
    loading: query.isLoading,
    refresh: () => queryClient.invalidateQueries({ queryKey: ["plans", projectPath] }),
  };
}

// ---------------------------------------------------------------------------
// useHosting — TanStack Query + mutations for hosting management
// ---------------------------------------------------------------------------

export function useHosting() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ["hosting", "status"],
    queryFn: fetchHostingStatus,
    refetchInterval: 120_000, // WS events are primary; polling is fallback only
  });

  const enableMutation = useMutation({
    mutationFn: enableHosting,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["hosting"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const disableMutation = useMutation({
    mutationFn: disableHosting,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["hosting"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const configureMutation = useMutation({
    mutationFn: configureHosting,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["hosting"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const restartMutation = useMutation({
    mutationFn: restartHosting,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["hosting"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const tunnelEnableMutation = useMutation({
    mutationFn: enableTunnel,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["hosting"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const tunnelDisableMutation = useMutation({
    mutationFn: disableTunnel,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["hosting"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const logsMutation = useMutation({
    mutationFn: ({ path, tail }: { path: string; tail?: number }) => fetchContainerLogs(path, tail),
  });

  return {
    status: statusQuery.data ?? null,
    loading: statusQuery.isLoading,
    error: statusQuery.error?.message ?? null,
    refresh: () => queryClient.invalidateQueries({ queryKey: ["hosting"] }),
    enable: useCallback(async (params: Parameters<typeof enableHosting>[0]) => {
      return enableMutation.mutateAsync(params);
    }, [enableMutation]),
    enabling: enableMutation.isPending,
    disable: useCallback(async (path: string) => {
      return disableMutation.mutateAsync(path);
    }, [disableMutation]),
    disabling: disableMutation.isPending,
    configure: useCallback(async (params: Parameters<typeof configureHosting>[0]) => {
      return configureMutation.mutateAsync(params);
    }, [configureMutation]),
    configuring: configureMutation.isPending,
    restart: useCallback(async (path: string) => {
      return restartMutation.mutateAsync(path);
    }, [restartMutation]),
    restarting: restartMutation.isPending,
    enableTunnel: useCallback(async (path: string) => {
      return tunnelEnableMutation.mutateAsync(path);
    }, [tunnelEnableMutation]),
    enablingTunnel: tunnelEnableMutation.isPending,
    disableTunnel: useCallback(async (path: string) => {
      return tunnelDisableMutation.mutateAsync(path);
    }, [tunnelDisableMutation]),
    disablingTunnel: tunnelDisableMutation.isPending,
    fetchLogs: useCallback(async (path: string, tail?: number) => {
      return logsMutation.mutateAsync({ path, tail });
    }, [logsMutation]),
    fetchingLogs: logsMutation.isPending,
  };
}

// ---------------------------------------------------------------------------
// useSystemStats — TanStack Query polling every 5s
// ---------------------------------------------------------------------------

export function useSystemStats() {
  const query = useQuery({
    queryKey: ["system", "stats"],
    queryFn: fetchSystemStats,
    refetchInterval: 5_000,
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

// ---------------------------------------------------------------------------
// useMachineInfo — TanStack Query with hostname mutation
// ---------------------------------------------------------------------------

export function useMachineInfo() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["machine", "info"],
    queryFn: fetchMachineInfo,
    refetchInterval: 30_000,
  });

  const hostnameMutation = useMutation({
    mutationFn: (hostname: string) => setMachineHostname(hostname),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["machine", "info"] });
    },
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refresh: () => queryClient.invalidateQueries({ queryKey: ["machine", "info"] }),
    setHostname: useCallback(async (hostname: string) => {
      return hostnameMutation.mutateAsync(hostname);
    }, [hostnameMutation]),
    settingHostname: hostnameMutation.isPending,
    hostnameError: hostnameMutation.error?.message ?? null,
  };
}

// ---------------------------------------------------------------------------
// useMachineHardware — full hardware snapshot (motherboard, BIOS, OS,
// CPU detail, memory, storage, network). Refetches on a slow cadence
// since hardware doesn't change often.
// ---------------------------------------------------------------------------

export function useMachineHardware() {
  const query = useQuery({
    queryKey: ["machine", "hardware"],
    queryFn: () => import("./api.js").then((m) => m.fetchMachineHardware()),
    refetchInterval: 5 * 60_000,
  });
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

// ---------------------------------------------------------------------------
// useLinuxUsers — TanStack Query + mutations
// ---------------------------------------------------------------------------

export function useLinuxUsers() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["machine", "users"],
    queryFn: fetchLinuxUsers,
  });

  const createMut = useMutation({
    mutationFn: createLinuxUser,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["machine", "users"] }); },
  });

  const updateMut = useMutation({
    mutationFn: (params: { username: string } & Parameters<typeof updateLinuxUser>[1]) => {
      const { username, ...rest } = params;
      return updateLinuxUser(username, rest);
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["machine", "users"] }); },
  });

  const deleteMut = useMutation({
    mutationFn: (params: { username: string; removeHome?: boolean }) =>
      deleteLinuxUser(params.username, params.removeHome),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["machine", "users"] }); },
  });

  return {
    users: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? createMut.error?.message ?? updateMut.error?.message ?? deleteMut.error?.message ?? null,
    refresh: () => queryClient.invalidateQueries({ queryKey: ["machine", "users"] }),
    create: useCallback(async (params: Parameters<typeof createLinuxUser>[0]) => {
      return createMut.mutateAsync(params);
    }, [createMut]),
    creating: createMut.isPending,
    update: useCallback(async (username: string, params: Parameters<typeof updateLinuxUser>[1]) => {
      return updateMut.mutateAsync({ username, ...params });
    }, [updateMut]),
    updating: updateMut.isPending,
    remove: useCallback(async (username: string, removeHome?: boolean) => {
      return deleteMut.mutateAsync({ username, removeHome });
    }, [deleteMut]),
    removing: deleteMut.isPending,
  };
}

// ---------------------------------------------------------------------------
// useAgents — TanStack Query with 10s polling
// ---------------------------------------------------------------------------

export function useAgents() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["agents"],
    queryFn: fetchAgents,
    refetchInterval: 10_000,
  });

  const restartMut = useMutation({
    mutationFn: restartAgent,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["agents"] }); },
  });

  return {
    agents: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refresh: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
    restart: useCallback(async (id: string) => {
      return restartMut.mutateAsync(id);
    }, [restartMut]),
    restarting: restartMut.isPending,
  };
}

// ---------------------------------------------------------------------------
// useReports — paginated report list
// ---------------------------------------------------------------------------

export function useReports(params?: {
  project?: string;
  limit?: number;
  offset?: number;
}) {
  const query = useQuery({
    queryKey: ["reports", params?.project ?? "", params?.limit ?? 20, params?.offset ?? 0],
    queryFn: () => fetchReports(params),
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

// ---------------------------------------------------------------------------
// useReport — single report detail
// ---------------------------------------------------------------------------

export function useReport(coaReqId: string) {
  const query = useQuery({
    queryKey: ["report", coaReqId],
    queryFn: () => fetchReport(coaReqId),
    enabled: coaReqId.length > 0,
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

// ---------------------------------------------------------------------------
// HuggingFace Marketplace hooks
// ---------------------------------------------------------------------------

export function useHFHardwareProfile() {
  return useQuery({
    queryKey: ["hf", "hardware"],
    queryFn: fetchHFHardwareProfile,
    refetchInterval: 30_000,
  });
}

export function useHFModels(params: Parameters<typeof searchHFModels>[0]) {
  return useQuery({
    queryKey: ["hf", "search", params],
    queryFn: () => searchHFModels(params),
    placeholderData: (prev: HFModelSearchResult[] | undefined) => prev,
  });
}

export function useHFInstalledModels() {
  return useQuery({
    queryKey: ["hf", "installed"],
    queryFn: fetchHFInstalledModels,
    refetchInterval: 10_000,
  });
}

export function useHFRunningModels() {
  return useQuery({
    queryKey: ["hf", "running"],
    queryFn: fetchHFRunningModels,
    refetchInterval: 5_000,
  });
}

export function useHFContainerStats() {
  return useQuery({
    queryKey: ["hf", "container-stats"],
    queryFn: fetchHFContainerStats,
    refetchInterval: 10_000,
  });
}

export function useHFDatasets(params: Parameters<typeof searchHFDatasets>[0]) {
  return useQuery({
    queryKey: ["hf", "datasets", "search", params],
    queryFn: () => searchHFDatasets(params),
    placeholderData: (prev: import("./types.js").HFDatasetSearchResult[] | undefined) => prev,
  });
}

export function useHFInstalledDatasets() {
  return useQuery({
    queryKey: ["hf", "datasets", "installed"],
    queryFn: fetchHFInstalledDatasets,
    refetchInterval: 10_000,
  });
}

// ---------------------------------------------------------------------------
// Fine-tune hooks (Phase 6)
// ---------------------------------------------------------------------------

export function useFineTuneJobs() {
  return useQuery({
    queryKey: ["hf", "finetune", "jobs"],
    queryFn: listFineTuneJobs,
    refetchInterval: 5_000,
  });
}

export function useFineTuneJob(jobId: string | null) {
  return useQuery({
    queryKey: ["hf", "finetune", "job", jobId],
    queryFn: () => getFineTuneStatus(jobId!),
    enabled: jobId !== null,
    refetchInterval: 5_000,
  });
}

// ---------------------------------------------------------------------------
// useIsMobile — reactive mobile breakpoint (≤767px)
// ---------------------------------------------------------------------------

function subscribeMobileQuery(callback: () => void) {
  const mql = window.matchMedia("(max-width: 767px)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribeMobileQuery,
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false,
  );
}

// ---------------------------------------------------------------------------
// Safemode + incidents
// ---------------------------------------------------------------------------

import {
  fetchSafemode as apiFetchSafemode,
  exitSafemode as apiExitSafemode,
  fetchAdminIncidents as apiFetchAdminIncidents,
  fetchAdminIncidentMarkdown as apiFetchAdminIncidentMarkdown,
  fetchRouterStatus,
} from "./api.js";

export function useSafemode() {
  return useQuery({
    queryKey: ["safemode"],
    queryFn: apiFetchSafemode,
    refetchInterval: 5_000,
    staleTime: 0,
  });
}

export function useExitSafemode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiExitSafemode,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["safemode"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["hf", "running"] });
    },
  });
}

export function useAdminIncidents() {
  return useQuery({
    queryKey: ["admin-incidents"],
    queryFn: apiFetchAdminIncidents,
    staleTime: 10_000,
  });
}

export function useAdminIncidentMarkdown(id: string | null) {
  return useQuery({
    queryKey: ["admin-incident", id],
    queryFn: () => apiFetchAdminIncidentMarkdown(id!),
    enabled: id !== null && id.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

// ---------------------------------------------------------------------------
// useRouterStatus — polls /api/router/status every 10s
// ---------------------------------------------------------------------------

export function useRouterStatus() {
  return useQuery({
    queryKey: ["router", "status"],
    queryFn: () => fetchRouterStatus(),
    refetchInterval: 10_000,
  });
}
