/**
 * AppSidebar — dual-mode sidebar with Admin button.
 *
 * Default view shows user-facing navigation (Projects, MagicApps, etc.).
 * Owner users see an "Admin" button at the bottom that switches to the
 * admin menu (Marketplace, Gateway, Settings, System).
 * Collapsible sidebar with icon-only mode. Mobile uses MobileMenu flyout.
 * Plugin-registered sidebar sections are merged at their configured positions.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Sidebar, MobileMenu } from "@particle-academy/react-fancy";
import { cn } from "@/lib/utils";
import { fetchPluginSidebar, fetchPluginDashboardPages, fetchPluginDashboardDomains } from "../api.js";
import type { PluginSidebarSection, PluginDashboardPage, PluginDashboardDomain } from "../types.js";
import {
  Folders, Inbox, LayoutDashboard, Link as LinkIcon, FileBarChart,
  Compass, FileText, GitBranch, Store, ScrollText, Rocket,
  SlidersHorizontal, Activity, Blocks, ShieldHalf, ShieldCheck,
  AlertTriangle, Building2, HardDrive, Fingerprint, Sparkles, Cpu,
  Shield, ArrowLeft, FileSearch, NotebookPen,
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
  position?: number;
}

type Mode = "main" | "admin";

interface NavSectionWithMode extends NavSection {
  mode: Mode;
}

const builtinSections: NavSectionWithMode[] = [
  // ── MAIN (user-facing) ──
  { mode: "main", title: "Overview", items: [
    { to: "/", label: "Dashboard", exact: true, icon: LayoutDashboard },
    { to: "/coa", label: "COA Explorer", icon: LinkIcon },
    { to: "/reports", label: "Reports", icon: FileBarChart },
  ]},
  { mode: "main", title: "Projects", items: [
    { to: "/projects", label: "All Projects", icon: Folders },
  ]},
  { mode: "main", title: "MagicApps", items: [
    { to: "/magic-apps", label: "All Apps", icon: Sparkles },
  ]},
  { mode: "main", title: "Communication", items: [
    { to: "/comms", label: "All Messages", exact: true, icon: Inbox },
  ]},
  { mode: "main", title: "Knowledge", items: [
    { to: "/knowledge", label: "Browse", icon: Compass },
    { to: "/docs", label: "Documentation", icon: FileText },
    // s152 — Global Notes page (markdown notepad surface, scoped to no project).
    { to: "/notes", label: "Notes", icon: NotebookPen },
  ]},
  // ── ADMIN ──
  { mode: "admin", title: "Overview", items: [
    { to: "/admin", label: "Dashboard", exact: true, icon: LayoutDashboard },
  ]},
  { mode: "admin", title: "Marketplace", items: [
    { to: "/gateway/marketplace", label: "Plugins", icon: Store },
    { to: "/magic-apps/admin", label: "MagicApps", icon: Sparkles },
    { to: "/hf-marketplace", label: "HF Models", icon: Cpu },
  ]},
  { mode: "admin", title: "Gateway", items: [
    { to: "/gateway/workflows", label: "Workflows", icon: GitBranch },
    { to: "/gateway/logs", label: "Logs", icon: ScrollText },
    { to: "/gateway/onboarding", label: "Onboarding", icon: Rocket },
  ]},
  { mode: "admin", title: "System", items: [
    { to: "/system", label: "Resources", exact: true, icon: Activity },
    { to: "/system/services", label: "Services", icon: Blocks },
    { to: "/system/agents", label: "Agents", icon: Cpu },
    { to: "/system/admin", label: "Machine", icon: ShieldHalf },
    { to: "/system/changelog", label: "Changelog", icon: ScrollText },
    { to: "/system/incidents", label: "Incidents", icon: AlertTriangle },
    { to: "/system/vendors", label: "Vendors", icon: Building2 },
    { to: "/system/backups", label: "Backups", icon: HardDrive },
    { to: "/system/security", label: "Security", icon: ShieldCheck },
    { to: "/system/identity", label: "Identity", icon: Fingerprint },
    { to: "/system/prompt-inspector", label: "Prompt Inspector", icon: FileSearch },
    { to: "/settings", label: "Settings", icon: SlidersHorizontal },
  ]},
];

/** Paths that indicate admin mode. */
const ADMIN_PREFIXES = ["/gateway", "/settings", "/system", "/hf-marketplace", "/admin"];

function detectMode(pathname: string): Mode {
  for (const prefix of ADMIN_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return "admin";
  }
  if (pathname.startsWith("/magic-apps/admin") || pathname.startsWith("/magic-apps/editor")) return "admin";
  return "main";
}

const domainRouteMap: Record<string, string> = {
  impactinomics: "", projects: "/projects", comms: "/comms",
  knowledge: "/knowledge", gateway: "/gateway", settings: "/settings", system: "/system",
};

/**
 * Derive the testid for a nav item from its route path + label. Shape:
 * `nav-<domain>-<label-slug>`. Matches what the Playwright e2e suite
 * expects (navigation.spec.ts / dashboard-overview.spec.ts).
 *
 * `domain` is the leading path segment mapped via `domainRouteMap` keys
 * (with `comms` → `communication` for the historic test fixture naming).
 * `label-slug` is the item's label kebab-cased.
 */
function deriveNavTestId(to: string, label: string): string {
  const firstSeg = to.split("/").filter(Boolean)[0] ?? "";
  let domain: string;
  if (firstSeg === "") domain = "impactinomics"; // root path
  else if (firstSeg === "comms") domain = "communication";
  else if (firstSeg === "coa" || firstSeg === "reports") domain = "impactinomics";
  else if (firstSeg === "admin") domain = "impactinomics";
  else if (firstSeg === "hf-marketplace") domain = "gateway";
  else if (firstSeg === "magic-apps") domain = "gateway";
  else domain = firstSeg;
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `nav-${domain}-${slug}`;
}

const domainTitleMap: Record<string, string> = {
  impactinomics: "Overview", projects: "Projects", comms: "Communication",
  knowledge: "Knowledge", gateway: "Gateway", settings: "Settings", system: "System",
};

export interface AppSidebarProps {
  isMobile: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
  hfEnabled?: boolean;
}

export function AppSidebar({ isMobile, mobileOpen, onMobileClose, hfEnabled = false }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;
  const [pluginSections, setPluginSections] = useState<PluginSidebarSection[]>([]);
  const [pluginPages, setPluginPages] = useState<PluginDashboardPage[]>([]);
  const [pluginDomains, setPluginDomains] = useState<PluginDashboardDomain[]>([]);

  const detected = detectMode(currentPath);
  const [manualMode, setManualMode] = useState<Mode | null>(null);
  const mode = manualMode ?? detected;

  // Reset manual override when URL changes to a different mode
  useEffect(() => { setManualMode(null); }, [detected]);

  useEffect(() => {
    fetchPluginSidebar().then(setPluginSections).catch(() => {});
    fetchPluginDashboardPages().then(setPluginPages).catch(() => {});
    fetchPluginDashboardDomains().then(setPluginDomains).catch(() => {});
  }, []);

  const sections = useMemo(() => {
    const baseSections: (NavSectionWithMode & { position: number })[] = [
      ...builtinSections.map((s, i) => ({ ...s, position: (i + 1) * 10 })),
      ...pluginSections.map((ps) => ({
        mode: "admin" as Mode,
        title: ps.title,
        items: ps.items.map((item) => ({ to: item.to, label: item.label, exact: item.exact })),
        position: ps.position ?? 50,
      })),
      ...pluginDomains.map((d) => ({
        mode: "main" as Mode,
        title: d.title,
        items: d.pages
          .sort((a, b) => (a.position ?? 100) - (b.position ?? 100))
          .map((p) => ({
            to: `/${d.routePrefix}${p.routePath ? `/${p.routePath}` : ""}`,
            label: p.label,
            exact: p.isIndex,
          })),
        position: d.position ?? 55,
      })),
    ];

    const pageItemsByDomain = new Map<string, NavItem[]>();
    for (const page of pluginPages) {
      const prefix = domainRouteMap[page.domain];
      if (prefix === undefined) continue;
      const items = pageItemsByDomain.get(page.domain) ?? [];
      items.push({ to: `${prefix}/${page.routePath}`, label: page.label });
      pageItemsByDomain.set(page.domain, items);
    }

    return baseSections.map((section) => {
      const domainEntry = Object.entries(domainTitleMap).find(([, title]) => title === section.title);
      const domain = domainEntry?.[0];
      let items = [...section.items];
      if (domain) {
        const extraItems = pageItemsByDomain.get(domain);
        if (extraItems) items = [...items, ...extraItems];
      }
      // Hide HF Models when not enabled
      if (!hfEnabled) {
        items = items.filter((item) => item.to !== "/hf-marketplace");
      }
      return { ...section, items };
    }).sort((a, b) => a.position - b.position);
  }, [pluginSections, pluginDomains, pluginPages, hfEnabled]);

  const visibleSections = sections.filter((s) => s.mode === mode);

  // ---------------------------------------------------------------------------
  // Mobile — MobileMenu flyout
  // ---------------------------------------------------------------------------

  if (isMobile) {
    return (
      <MobileMenu.Flyout
        open={mobileOpen}
        onClose={onMobileClose}
        side="left"
        title="Aionima"
      >
        {visibleSections.map((section) => (
          <div key={section.title}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-3 pt-4 pb-1">
              {section.title}
            </div>
            {section.items.map((item) => {
              const isActive = item.exact
                ? currentPath === item.to
                : currentPath === item.to || currentPath.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <MobileMenu.Item
                  key={item.to}
                  active={isActive}
                  icon={Icon ? <Icon className="w-4 h-4" /> : undefined}
                  onClick={() => { navigate(item.to); onMobileClose(); }}
                >
                  {item.label}
                </MobileMenu.Item>
              );
            })}
          </div>
        ))}

        {/* Mode toggle at bottom */}
        <div className="border-t border-border mt-4 pt-2 px-3">
          {mode === "main" ? (
            <MobileMenu.Item
              icon={<Shield className="w-4 h-4" />}
              onClick={() => { setManualMode("admin"); navigate("/admin"); onMobileClose(); }}
            >
              Admin
            </MobileMenu.Item>
          ) : (
            <MobileMenu.Item
              icon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => { setManualMode("main"); navigate("/"); onMobileClose(); }}
            >
              Back
            </MobileMenu.Item>
          )}
        </div>
      </MobileMenu.Flyout>
    );
  }

  // ---------------------------------------------------------------------------
  // Desktop — collapsible Sidebar
  // ---------------------------------------------------------------------------

  // Wrapped in a div with the testid because the react-fancy <Sidebar>
  // component doesn't forward `data-testid` to its rendered DOM root.
  // Playwright specs target `[data-testid='app-sidebar']` — this wrapper
  // makes that selector match the visible sidebar element.
  return (
    <div data-testid="app-sidebar">
    <Sidebar defaultCollapsed={false} collapseMode="icons" className="!w-[200px] [&_button]:w-full [&_a]:w-full">
      {/* Logo */}
      <div className="px-3 py-3 border-b border-border">
        <Link to="/" className="flex items-center gap-2 text-foreground no-underline">
          <img src="/spore-seed-clear.svg" alt="" width={24} height={24} className="shrink-0" />
          <span className="text-sm font-bold">Aionima</span>
        </Link>
      </div>

      {/* Nav sections */}
      {visibleSections.map((section) => (
        <Sidebar.Group key={section.title} label={section.title}>
          {section.items.map((item) => {
            const isActive = item.exact
              ? currentPath === item.to
              : currentPath === item.to || currentPath.startsWith(item.to + "/");
            const Icon = item.icon;
            const testId = deriveNavTestId(item.to, item.label);
            return (
              <Sidebar.Item
                key={item.to}
                active={isActive}
                icon={Icon ? <Icon className="w-4 h-4" /> : undefined}
                onClick={() => navigate(item.to)}
                data-testid={testId}
              >
                {item.label}
              </Sidebar.Item>
            );
          })}
        </Sidebar.Group>
      ))}

      {/* Mode toggle + collapse at bottom */}
      <div className="mt-auto border-t border-border">
        {mode === "main" ? (
          <Sidebar.Item
            icon={<Shield className="w-4 h-4" />}
            onClick={() => { setManualMode("admin"); navigate("/admin"); }}
          >
            Admin
          </Sidebar.Item>
        ) : (
          <Sidebar.Item
            icon={<ArrowLeft className="w-4 h-4" />}
            onClick={() => { setManualMode("main"); navigate("/"); }}
          >
            Back
          </Sidebar.Item>
        )}
        <Sidebar.Toggle />
      </div>
    </Sidebar>
    </div>
  );
}
