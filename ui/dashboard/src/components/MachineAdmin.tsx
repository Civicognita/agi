/**
 * MachineAdmin — machine identity, Linux user management, and agent status.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useMachineInfo, useLinuxUsers, useAgents } from "@/hooks.js";
import {
  fetchSSHKeys,
  addSSHKey,
  removeSSHKey,
  fetchAuthStatus,
  fetchDashboardUsers,
  createDashboardUser,
  updateDashboardUser,
  deleteDashboardUser,
  resetDashboardUserPassword,
  fetchSambaShares,
  enableSambaShare,
  disableSambaShare,
} from "@/api.js";
import type { LinuxUser, SSHKey, DashboardUserInfo, DashboardRole, SambaShare } from "@/types.js";
import { HardwareScanner } from "@/components/HardwareScanner.js";

// ---------------------------------------------------------------------------
// Shared section heading
// ---------------------------------------------------------------------------

function SectionHeading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("text-base font-semibold text-card-foreground mb-4 pb-2 border-b border-border", className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---------------------------------------------------------------------------
// ShareLink — copy-to-clipboard row for a network share path
// ---------------------------------------------------------------------------

function ShareLink({ label, value, highlight }: { label: string; value: string; highlight: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [value]);

  return (
    <div className={cn(
      "flex items-center gap-2 text-[11px] rounded px-2 py-1",
      highlight ? "bg-primary/10 border border-primary/20" : "",
    )}>
      <span className={cn("font-medium w-14 shrink-0", highlight ? "text-primary" : "text-muted-foreground")}>{label}</span>
      <code className="text-foreground font-mono truncate flex-1">{value}</code>
      <button
        onClick={handleCopy}
        className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none shrink-0"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MachineAdmin() {
  const machine = useMachineInfo();
  const users = useLinuxUsers();
  const agents = useAgents();

  // Hostname inline edit state
  const [editingHostname, setEditingHostname] = useState(false);
  const [hostnameValue, setHostnameValue] = useState("");

  // Create user dialog
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", shell: "/bin/bash", addToSudo: false });

  // Delete user confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteRemoveHome, setDeleteRemoveHome] = useState(false);

  // SSH keys dialog
  const [sshUser, setSSHUser] = useState<string | null>(null);
  const [sshKeys, setSSHKeys] = useState<SSHKey[]>([]);
  const [sshLoading, setSSHLoading] = useState(false);
  const [newSSHKey, setNewSSHKey] = useState("");

  // Dashboard users state
  const [dashAuthEnabled, setDashAuthEnabled] = useState<boolean | null>(null);
  const [dashUsers, setDashUsers] = useState<DashboardUserInfo[]>([]);
  const [dashLoading, setDashLoading] = useState(false);
  const [createDashUserOpen, setCreateDashUserOpen] = useState(false);
  const [newDashUser, setNewDashUser] = useState({ username: "", displayName: "", password: "", role: "viewer" as DashboardRole });
  const [deleteDashTarget, setDeleteDashTarget] = useState<DashboardUserInfo | null>(null);
  const [resetPwTarget, setResetPwTarget] = useState<DashboardUserInfo | null>(null);
  const [resetPwValue, setResetPwValue] = useState("");

  // Samba shares
  const [sambaShares, setSambaShares] = useState<SambaShare[]>([]);
  const [sambaLoading, setSambaLoading] = useState(true);
  const [sambaToggling, setSambaToggling] = useState<string | null>(null);

  // Error display
  const [actionError, setActionError] = useState<string | null>(null);

  const handleStartEditHostname = useCallback(() => {
    setHostnameValue(machine.data?.hostname ?? "");
    setEditingHostname(true);
  }, [machine.data?.hostname]);

  const handleSaveHostname = useCallback(async () => {
    try {
      await machine.setHostname(hostnameValue);
      setEditingHostname(false);
      setActionError(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to set hostname");
    }
  }, [hostnameValue, machine]);

  const handleCreateUser = useCallback(async () => {
    try {
      await users.create(newUser);
      setCreateUserOpen(false);
      setNewUser({ username: "", password: "", shell: "/bin/bash", addToSudo: false });
      setActionError(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to create user");
    }
  }, [newUser, users]);

  const handleDeleteUser = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await users.remove(deleteTarget, deleteRemoveHome);
      setDeleteTarget(null);
      setDeleteRemoveHome(false);
      setActionError(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to delete user");
    }
  }, [deleteTarget, deleteRemoveHome, users]);

  const handleToggleLock = useCallback(async (u: LinuxUser) => {
    try {
      await users.update(u.username, { locked: !u.locked });
      setActionError(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to toggle lock");
    }
  }, [users]);

  const handleOpenSSH = useCallback(async (username: string) => {
    setSSHUser(username);
    setSSHLoading(true);
    try {
      const keys = await fetchSSHKeys(username);
      setSSHKeys(keys);
    } catch {
      setSSHKeys([]);
    }
    setSSHLoading(false);
  }, []);

  const handleAddSSHKey = useCallback(async () => {
    if (!sshUser || !newSSHKey.trim()) return;
    try {
      await addSSHKey(sshUser, newSSHKey.trim());
      const keys = await fetchSSHKeys(sshUser);
      setSSHKeys(keys);
      setNewSSHKey("");
      setActionError(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to add SSH key");
    }
  }, [sshUser, newSSHKey]);

  const handleRemoveSSHKey = useCallback(async (index: number) => {
    if (!sshUser) return;
    try {
      await removeSSHKey(sshUser, index);
      const keys = await fetchSSHKeys(sshUser);
      setSSHKeys(keys);
      setActionError(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to remove SSH key");
    }
  }, [sshUser]);

  const handleRestartAgent = useCallback(async (id: string) => {
    try {
      await agents.restart(id);
      setActionError(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to restart agent");
    }
  }, [agents]);

  // Load samba shares
  const loadSambaShares = useCallback(async () => {
    try {
      const shares = await fetchSambaShares();
      setSambaShares(shares);
    } catch {
      setSambaShares([]);
    }
    setSambaLoading(false);
  }, []);

  useEffect(() => { void loadSambaShares(); }, [loadSambaShares]);

  const handleToggleSamba = useCallback(async (share: SambaShare) => {
    setSambaToggling(share.name);
    // Optimistic update
    setSambaShares((prev) => prev.map((s) => s.name === share.name ? { ...s, enabled: !s.enabled } : s));
    try {
      if (share.enabled) {
        await disableSambaShare(share.name);
      } else {
        await enableSambaShare(share.name);
      }
      setActionError(null);
    } catch (e) {
      // Rollback
      setSambaShares((prev) => prev.map((s) => s.name === share.name ? { ...s, enabled: share.enabled } : s));
      setActionError(e instanceof Error ? e.message : "Failed to toggle share");
    }
    setSambaToggling(null);
  }, []);

  // Load dashboard auth status + users
  const loadDashUsers = useCallback(async () => {
    try {
      const status = await fetchAuthStatus();
      setDashAuthEnabled(status.enabled);
      if (status.enabled) {
        setDashLoading(true);
        const token = localStorage.getItem("aionima-dashboard-token") ?? "";
        const users = await fetchDashboardUsers(token);
        setDashUsers(users);
        setDashLoading(false);
      }
    } catch {
      setDashAuthEnabled(false);
    }
  }, []);

  useEffect(() => { void loadDashUsers(); }, [loadDashUsers]);

  const handleCreateDashUser = useCallback(async () => {
    try {
      const token = localStorage.getItem("aionima-dashboard-token") ?? "";
      await createDashboardUser(token, newDashUser);
      setCreateDashUserOpen(false);
      setNewDashUser({ username: "", displayName: "", password: "", role: "viewer" });
      setActionError(null);
      void loadDashUsers();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to create dashboard user");
    }
  }, [newDashUser, loadDashUsers]);

  const handleDeleteDashUser = useCallback(async () => {
    if (!deleteDashTarget) return;
    try {
      const token = localStorage.getItem("aionima-dashboard-token") ?? "";
      await deleteDashboardUser(token, deleteDashTarget.id);
      setDeleteDashTarget(null);
      setActionError(null);
      void loadDashUsers();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to delete dashboard user");
    }
  }, [deleteDashTarget, loadDashUsers]);

  const handleToggleDashUserDisabled = useCallback(async (u: DashboardUserInfo) => {
    try {
      const token = localStorage.getItem("aionima-dashboard-token") ?? "";
      await updateDashboardUser(token, u.id, { disabled: !u.disabled });
      setActionError(null);
      void loadDashUsers();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to update dashboard user");
    }
  }, [loadDashUsers]);

  const handleResetPassword = useCallback(async () => {
    if (!resetPwTarget || !resetPwValue) return;
    try {
      const token = localStorage.getItem("aionima-dashboard-token") ?? "";
      await resetDashboardUserPassword(token, resetPwTarget.id, resetPwValue);
      setResetPwTarget(null);
      setResetPwValue("");
      setActionError(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to reset password");
    }
  }, [resetPwTarget, resetPwValue]);

  if (machine.loading) {
    return <div className="text-[12px] text-muted-foreground py-8">Loading machine info...</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Error banner */}
      {actionError && (
        <div className="rounded-lg bg-red/10 border border-red/30 px-4 py-2 text-[12px] text-red flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red hover:text-foreground cursor-pointer bg-transparent border-none text-[11px]">
            Dismiss
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* Hardware Section */}
      {/* ================================================================= */}
      <Card className="p-6 gap-0">
        <SectionHeading>Hardware</SectionHeading>
        <HardwareScanner />
      </Card>

      {/* ================================================================= */}
      {/* Agents Section */}
      {/* ================================================================= */}
      <Card className="p-6 gap-0">
        <SectionHeading>Agents</SectionHeading>
        {agents.loading ? (
          <div className="text-[12px] text-muted-foreground">Loading agents...</div>
        ) : agents.agents.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">No agents registered</div>
        ) : (
          <div className="grid gap-3">
            {agents.agents.map((agent) => {
              const statusColor = {
                running: "bg-green",
                stopped: "bg-muted-foreground",
                error: "bg-red",
                unknown: "bg-yellow",
              }[agent.status];

              return (
                <div
                  key={agent.id}
                  className={cn(
                    "rounded-lg border p-4",
                    agent.type === "gateway" ? "border-primary/30 bg-primary/5" : "border-border",
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={cn("inline-block w-2.5 h-2.5 rounded-full", statusColor)} />
                      <span className="text-[14px] font-semibold text-foreground">{agent.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue/15 text-blue font-medium">
                        {agent.type}
                      </span>
                      {agent.type === "gateway" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                          primary
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={agents.restarting}
                        onClick={() => void handleRestartAgent(agent.id)}
                        className="text-[11px] h-7"
                      >
                        Restart
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
                    <span className={cn("font-semibold capitalize", agent.status === "running" ? "text-green" : "text-red")}>
                      {agent.status}
                    </span>
                    {agent.uptime !== null && (
                      <span>Uptime: <code className="text-foreground">{formatUptime(agent.uptime)}</code></span>
                    )}
                    {agent.pid !== null && (
                      <span>PID: <code className="text-foreground">{agent.pid}</code></span>
                    )}
                    {agent.memoryMB !== null && (
                      <span>Memory: <code className="text-foreground">{agent.memoryMB} MB</code></span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ================================================================= */}
      {/* Network Shares Section */}
      {/* ================================================================= */}
      <Card className="p-6 gap-0">
        <SectionHeading>Network Shares</SectionHeading>
        {sambaLoading ? (
          <div className="text-[12px] text-muted-foreground">Loading shares...</div>
        ) : sambaShares.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">No network shares configured</div>
        ) : (
          <div className="grid gap-3">
            {sambaShares.map((share) => {
              const hn = machine.data?.hostname ?? "localhost";
              const uncPath = `\\\\${hn}\\${share.name}`;
              const smbUrl = `smb://${hn}/${share.name}`;
              const toggling = sambaToggling === share.name;

              return (
                <div key={share.name} className="rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleToggleSamba(share)}
                        disabled={toggling}
                        className={cn(
                          "w-8 h-5 rounded-full transition-colors relative cursor-pointer border-none disabled:opacity-60 disabled:cursor-wait",
                          share.enabled ? "bg-green" : "bg-surface1",
                        )}
                      >
                        <span className={cn(
                          "block w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all",
                          share.enabled ? "left-4" : "left-0.5",
                        )} />
                      </button>
                      <div>
                        <span className="text-[13px] font-semibold text-foreground">{share.name}</span>
                        <span className="text-[11px] text-muted-foreground ml-2">{share.path}</span>
                      </div>
                    </div>
                  </div>
                  {share.enabled && (
                    <div className="mt-3 grid gap-1.5 pl-11">
                      <ShareLink label="Windows" value={uncPath} highlight={/windows/i.test(navigator.userAgent)} />
                      <ShareLink label="macOS" value={smbUrl} highlight={/macintosh/i.test(navigator.userAgent)} />
                      <ShareLink label="Linux" value={smbUrl} highlight={/linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ================================================================= */}
      {/* Machine Identity Section */}
      {/* ================================================================= */}
      <Card className="p-6 gap-0">
        <SectionHeading>Machine Identity</SectionHeading>
        {machine.data ? (
          <div className="grid grid-cols-2 gap-4">
            {/* Hostname - editable */}
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">Hostname</div>
              {editingHostname ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={hostnameValue}
                    onChange={(e) => setHostnameValue(e.target.value)}
                    className="h-8 text-[13px]"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleSaveHostname()}
                    disabled={machine.settingHostname}
                    className="text-[11px] h-8"
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingHostname(false)}
                    className="text-[11px] h-8"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <code className="text-[13px] text-foreground">{machine.data.hostname}</code>
                  <button
                    onClick={handleStartEditHostname}
                    className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none"
                    title="Edit hostname"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>

            {/* Read-only fields */}
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">IP Address</div>
              <code className="text-[13px] text-foreground">{machine.data.ip}</code>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">OS / Distro</div>
              <code className="text-[13px] text-foreground">{machine.data.distro}</code>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">Kernel</div>
              <code className="text-[13px] text-foreground">{machine.data.kernel}</code>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">Architecture</div>
              <code className="text-[13px] text-foreground">{machine.data.arch}</code>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">CPU</div>
              <code className="text-[13px] text-foreground">{machine.data.cpuModel}</code>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">Total RAM</div>
              <code className="text-[13px] text-foreground">{machine.data.totalMemoryGB} GB</code>
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-muted-foreground">Failed to load machine info</div>
        )}
      </Card>

      {/* ================================================================= */}
      {/* Linux Users Section */}
      {/* ================================================================= */}
      <Card className="p-6 gap-0">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
          <div className="text-base font-semibold text-card-foreground">Linux Users</div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreateUserOpen(true)}
            className="text-[11px] h-7"
          >
            Create User
          </Button>
        </div>

        {users.loading ? (
          <div className="text-[12px] text-muted-foreground">Loading users...</div>
        ) : users.users.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">No users found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-2 font-medium">Username</th>
                  <th className="text-left py-2 px-2 font-medium">UID</th>
                  <th className="text-left py-2 px-2 font-medium">Shell</th>
                  <th className="text-left py-2 px-2 font-medium">Groups</th>
                  <th className="text-center py-2 px-2 font-medium">Sudo</th>
                  <th className="text-center py-2 px-2 font-medium">SSH</th>
                  <th className="text-center py-2 px-2 font-medium">Status</th>
                  <th className="text-right py-2 px-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.users.map((u) => (
                  <tr key={u.username} className="border-b border-border/50 hover:bg-secondary/30">
                    <td className="py-2 px-2">
                      <code className="text-foreground font-medium">{u.username}</code>
                    </td>
                    <td className="py-2 px-2 text-muted-foreground">{u.uid}</td>
                    <td className="py-2 px-2">
                      <code className="text-muted-foreground">{u.shell}</code>
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex gap-1 flex-wrap">
                        {u.groups.slice(0, 5).map((g) => (
                          <span key={g} className="text-[10px] px-1 py-0.5 rounded bg-secondary text-muted-foreground">
                            {g}
                          </span>
                        ))}
                        {u.groups.length > 5 && (
                          <span className="text-[10px] text-muted-foreground">+{u.groups.length - 5}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-center">
                      {u.sudo ? (
                        <span className="text-green font-semibold">Yes</span>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <button
                        onClick={() => void handleOpenSSH(u.username)}
                        className={cn(
                          "cursor-pointer bg-transparent border-none text-[11px]",
                          u.hasSSHKeys ? "text-blue hover:underline" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {u.hasSSHKeys ? "Keys" : "None"}
                      </button>
                    </td>
                    <td className="py-2 px-2 text-center">
                      {u.locked ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red/15 text-red font-medium">Locked</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/15 text-green font-medium">Active</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => void handleToggleLock(u)}
                          disabled={u.username === "root" || users.updating}
                          className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none disabled:opacity-50 disabled:cursor-default"
                        >
                          {u.locked ? "Unlock" : "Lock"}
                        </button>
                        <button
                          onClick={() => setDeleteTarget(u.username)}
                          disabled={u.username === "root"}
                          className="text-[11px] text-red hover:text-red/80 cursor-pointer bg-transparent border-none disabled:opacity-50 disabled:cursor-default"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ================================================================= */}
      {/* Dashboard Users Section */}
      {/* ================================================================= */}
      {dashAuthEnabled && (
        <Card className="p-6 gap-0">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
            <div className="text-base font-semibold text-card-foreground">Dashboard Users</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreateDashUserOpen(true)}
              className="text-[11px] h-7"
            >
              Create User
            </Button>
          </div>

          {dashLoading ? (
            <div className="text-[12px] text-muted-foreground">Loading dashboard users...</div>
          ) : dashUsers.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">No dashboard users configured</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2 font-medium">Username</th>
                    <th className="text-left py-2 px-2 font-medium">Display Name</th>
                    <th className="text-center py-2 px-2 font-medium">Role</th>
                    <th className="text-center py-2 px-2 font-medium">Status</th>
                    <th className="text-left py-2 px-2 font-medium">Last Login</th>
                    <th className="text-right py-2 px-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dashUsers.map((u) => (
                    <tr key={u.id} className="border-b border-border/50 hover:bg-secondary/30">
                      <td className="py-2 px-2">
                        <code className="text-foreground font-medium">{u.username}</code>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">{u.displayName}</td>
                      <td className="py-2 px-2 text-center">
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium",
                          u.role === "admin" ? "bg-primary/15 text-primary" :
                          u.role === "operator" ? "bg-blue/15 text-blue" :
                          "bg-secondary text-muted-foreground",
                        )}>
                          {u.role}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-center">
                        {u.disabled ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red/15 text-red font-medium">Disabled</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/15 text-green font-medium">Active</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground text-[11px]">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => void handleToggleDashUserDisabled(u)}
                            className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none"
                          >
                            {u.disabled ? "Enable" : "Disable"}
                          </button>
                          <button
                            onClick={() => { setResetPwTarget(u); setResetPwValue(""); }}
                            className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none"
                          >
                            Reset PW
                          </button>
                          <button
                            onClick={() => setDeleteDashTarget(u)}
                            className="text-[11px] text-red hover:text-red/80 cursor-pointer bg-transparent border-none"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ================================================================= */}
      {/* Create Dashboard User Dialog */}
      {/* ================================================================= */}
      <Dialog open={createDashUserOpen} onOpenChange={setCreateDashUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Dashboard User</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Username</label>
              <Input
                value={newDashUser.username}
                onChange={(e) => setNewDashUser((p) => ({ ...p, username: e.target.value }))}
                className="h-8 text-[13px]"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Display Name</label>
              <Input
                value={newDashUser.displayName}
                onChange={(e) => setNewDashUser((p) => ({ ...p, displayName: e.target.value }))}
                className="h-8 text-[13px]"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Password</label>
              <Input
                type="password"
                value={newDashUser.password}
                onChange={(e) => setNewDashUser((p) => ({ ...p, password: e.target.value }))}
                className="h-8 text-[13px]"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Role</label>
              <select
                value={newDashUser.role}
                onChange={(e) => setNewDashUser((p) => ({ ...p, role: e.target.value as DashboardRole }))}
                className="h-8 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground"
              >
                <option value="admin">Admin</option>
                <option value="operator">Operator</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDashUserOpen(false)}>Cancel</Button>
            <Button
              onClick={() => void handleCreateDashUser()}
              disabled={!newDashUser.username || !newDashUser.password}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* Delete Dashboard User Confirmation */}
      {/* ================================================================= */}
      <Dialog open={deleteDashTarget !== null} onOpenChange={() => setDeleteDashTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Dashboard User: {deleteDashTarget?.username}</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            Are you sure you want to delete <code>{deleteDashTarget?.username}</code>?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDashTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleDeleteDashUser()}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* Reset Password Dialog */}
      {/* ================================================================= */}
      <Dialog open={resetPwTarget !== null} onOpenChange={() => setResetPwTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password: {resetPwTarget?.username}</DialogTitle>
          </DialogHeader>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">New Password</label>
            <Input
              type="password"
              value={resetPwValue}
              onChange={(e) => setResetPwValue(e.target.value)}
              className="h-8 text-[13px]"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPwTarget(null)}>Cancel</Button>
            <Button onClick={() => void handleResetPassword()} disabled={!resetPwValue}>Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* Create User Dialog */}
      {/* ================================================================= */}
      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Linux User</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Username</label>
              <Input
                value={newUser.username}
                onChange={(e) => setNewUser((p) => ({ ...p, username: e.target.value }))}
                placeholder="username"
                className="h-8 text-[13px]"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Password</label>
              <Input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
                placeholder="(optional)"
                className="h-8 text-[13px]"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Shell</label>
              <Input
                value={newUser.shell}
                onChange={(e) => setNewUser((p) => ({ ...p, shell: e.target.value }))}
                className="h-8 text-[13px]"
              />
            </div>
            <label className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={newUser.addToSudo}
                onChange={(e) => setNewUser((p) => ({ ...p, addToSudo: e.target.checked }))}
              />
              Add to sudo group
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateUserOpen(false)}>Cancel</Button>
            <Button
              onClick={() => void handleCreateUser()}
              disabled={!newUser.username || users.creating}
            >
              {users.creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* Delete User Confirmation */}
      {/* ================================================================= */}
      <Dialog open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User: {deleteTarget}</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            Are you sure you want to delete the user <code>{deleteTarget}</code>?
            This action cannot be undone.
          </p>
          <label className="flex items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={deleteRemoveHome}
              onChange={(e) => setDeleteRemoveHome(e.target.checked)}
            />
            Also remove home directory
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteUser()}
              disabled={users.removing}
            >
              {users.removing ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* SSH Keys Dialog */}
      {/* ================================================================= */}
      <Dialog open={sshUser !== null} onOpenChange={() => { setSSHUser(null); setSSHKeys([]); setNewSSHKey(""); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>SSH Keys: {sshUser}</DialogTitle>
          </DialogHeader>
          {sshLoading ? (
            <div className="text-[12px] text-muted-foreground">Loading keys...</div>
          ) : (
            <div className="grid gap-2">
              {sshKeys.length === 0 ? (
                <div className="text-[12px] text-muted-foreground">No authorized keys</div>
              ) : (
                sshKeys.map((k) => (
                  <div key={k.index} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/30 p-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-[11px] font-mono text-muted-foreground truncate block">
                        {k.type} ...{k.key.slice(-20)} {k.comment}
                      </span>
                    </div>
                    <button
                      onClick={() => void handleRemoveSSHKey(k.index)}
                      className="text-[11px] text-red hover:text-red/80 cursor-pointer bg-transparent border-none shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
              <div className="flex gap-2 mt-2">
                <Input
                  value={newSSHKey}
                  onChange={(e) => setNewSSHKey(e.target.value)}
                  placeholder="ssh-ed25519 AAAA... comment"
                  className="h-8 text-[12px] font-mono flex-1"
                />
                <Button
                  size="sm"
                  onClick={() => void handleAddSSHKey()}
                  disabled={!newSSHKey.trim()}
                  className="text-[11px] h-8"
                >
                  Add
                </Button>
              </div>
            </div>
          )}
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}
