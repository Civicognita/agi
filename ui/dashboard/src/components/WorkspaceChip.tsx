/**
 * WorkspaceChip — Hearth top-bar workspace switcher + navigation dropdown.
 *
 * Shows the active workspace as a colored dot + name chip. Clicking opens a
 * dropdown with workspace options and all navigation sections (replacing the
 * AppSidebar's nav tree in the Hearth shell direction).
 *
 * PAx future: WorkspaceChip is an ADF-level primitive; a PAx issue should be
 * filed once the Hearth shell is stable to upstream it into react-fancy.
 */

import { useState } from "react";
import { Link, useLocation } from "react-router";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Folders, Inbox, LayoutDashboard, Link as LinkIcon, FileBarChart,
  Compass, FileText, GitBranch, Store, ScrollText, Rocket,
  SlidersHorizontal, Activity, Blocks, ShieldHalf, ShieldCheck,
  AlertTriangle, Building2, HardDrive, Fingerprint, Sparkles, Cpu,
  Shield, FileSearch, NotebookPen, MessageCircle, Mail,
  Send, MessageSquare, Settings2, KeyRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  exact?: boolean;
  icon?: LucideIcon;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const MAIN_NAV: NavSection[] = [
  { title: "Overview", items: [
    { to: "/", label: "Dashboard", exact: true, icon: LayoutDashboard },
    { to: "/coa", label: "COA Explorer", icon: LinkIcon },
    { to: "/reports", label: "Reports", icon: FileBarChart },
  ]},
  { title: "Projects", items: [
    { to: "/projects", label: "All Projects", icon: Folders },
  ]},
  { title: "MagicApps", items: [
    { to: "/magic-apps", label: "All Apps", icon: Sparkles },
  ]},
  { title: "Communication", items: [
    { to: "/comms",             label: "All Messages",     exact: true, icon: Inbox },
    { to: "/comms/discord",     label: "Discord",          icon: MessageCircle },
    { to: "/comms/gmail",       label: "Gmail",            icon: Mail },
    { to: "/comms/telegram",    label: "Telegram",         icon: Send },
    { to: "/comms/signal",      label: "Signal",           icon: ShieldCheck },
    { to: "/comms/whatsapp",    label: "WhatsApp",         icon: MessageSquare },
    { to: "/comms/moderation",  label: "Moderation",       icon: Shield },
    { to: "/comms/channels",    label: "Channels",         icon: Settings2 },
    { to: "/identity/pending",  label: "Pending Identity", icon: Fingerprint },
  ]},
  { title: "Knowledge", items: [
    { to: "/knowledge", label: "Browse",        icon: Compass },
    { to: "/docs",      label: "Documentation", icon: FileText },
    { to: "/notes",     label: "Notes",         icon: NotebookPen },
  ]},
];

const ADMIN_NAV: NavSection[] = [
  { title: "Marketplace", items: [
    { to: "/gateway/marketplace", label: "Plugins",  icon: Store },
    { to: "/magic-apps/admin",    label: "MagicApps", icon: Sparkles },
    { to: "/hf-marketplace",      label: "HF Models", icon: Cpu },
  ]},
  { title: "Gateway", items: [
    { to: "/gateway/workflows", label: "Workflows",  icon: GitBranch },
    { to: "/gateway/logs",      label: "Logs",       icon: ScrollText },
    { to: "/gateway/onboarding", label: "Onboarding", icon: Rocket },
    { to: "/settings/vault",    label: "Vault",      icon: KeyRound },
  ]},
  { title: "System", items: [
    { to: "/system",             label: "Resources",       exact: true, icon: Activity },
    { to: "/system/services",    label: "Services",        icon: Blocks },
    { to: "/system/agents",      label: "Agents",          icon: Cpu },
    { to: "/system/admin",       label: "Machine",         icon: ShieldHalf },
    { to: "/system/changelog",   label: "Changelog",       icon: ScrollText },
    { to: "/system/incidents",   label: "Incidents",       icon: AlertTriangle },
    { to: "/system/vendors",     label: "Vendors",         icon: Building2 },
    { to: "/system/backups",     label: "Backups",         icon: HardDrive },
    { to: "/system/security",    label: "Security",        icon: ShieldCheck },
    { to: "/system/identity",    label: "Identity",        icon: Fingerprint },
    { to: "/system/prompt-inspector", label: "Prompt Inspector", icon: FileSearch },
    { to: "/settings",           label: "Settings",        icon: SlidersHorizontal },
  ]},
];

interface Workspace {
  name: string;
  color: string;
}

interface WorkspaceChipProps {
  workspaces: Workspace[];
  activeIndex: number;
}

function NavLink({ item, onClose }: { item: NavItem; onClose: () => void }) {
  const { pathname } = useLocation();
  const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onClose}
      className={cn(
        "flex items-center gap-2 px-2 py-1 rounded-md text-[12px] transition-colors",
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary",
      )}
    >
      {Icon && <Icon size={13} className="shrink-0" />}
      <span>{item.label}</span>
    </Link>
  );
}

export function WorkspaceChip({ workspaces, activeIndex }: WorkspaceChipProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"main" | "admin">("main");
  const active = workspaces[activeIndex] ?? { name: "Home", color: "#10b981" };
  const sections = tab === "main" ? MAIN_NAV : ADMIN_NAV;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        data-testid="workspace-chip"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card hover:bg-secondary transition-colors text-sm"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-md text-white text-[10px] font-bold shrink-0"
          style={{ background: active.color }}
        >
          {active.name[0]}
        </span>
        <span className="font-medium max-w-[100px] truncate">{active.name}</span>
        <ChevronsUpDown size={13} className="text-muted-foreground shrink-0" />
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-[190]" onClick={() => setOpen(false)} />

          <div data-testid="workspace-chip-dropdown" className="absolute left-0 top-[calc(100%+6px)] z-[200] w-[280px] bg-popover border border-border rounded-xl shadow-lg overflow-hidden">
            {/* workspace switcher */}
            <div className="p-2 border-b border-border">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1.5">Workspace</div>
              <div className="flex flex-col gap-0.5">
                {workspaces.map((ws, i) => (
                  <div
                    key={ws.name}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] cursor-default",
                      i === activeIndex ? "bg-secondary font-medium" : "text-muted-foreground",
                    )}
                  >
                    <span
                      className="w-4 h-4 rounded-sm shrink-0"
                      style={{ background: ws.color }}
                    />
                    {ws.name}
                    {i === activeIndex && <span className="ml-auto text-[10px] text-muted-foreground">active</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* nav toggle */}
            <div className="flex gap-1 p-2 border-b border-border">
              {(["main", "admin"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "flex-1 py-1 rounded-md text-[11px] font-medium transition-colors capitalize",
                    tab === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "main" ? "Main" : "Admin"}
                </button>
              ))}
            </div>

            {/* nav items */}
            <div className="p-2 max-h-[60vh] overflow-y-auto">
              {sections.map((section) => (
                <div key={section.title} className="mb-2 last:mb-0">
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
                    {section.title}
                  </div>
                  {section.items.map((item) => (
                    <NavLink key={item.to} item={item} onClose={() => setOpen(false)} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
