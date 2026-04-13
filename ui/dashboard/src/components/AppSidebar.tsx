/**
 * AppSidebar — unified sidebar navigation with Admin button.
 *
 * All sections are visible at once (no perspective switching).
 * Admin button at the bottom opens the Admin Dashboard.
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
  SlidersHorizontal, Sparkles, Cpu, Shield,
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

const builtinSections: NavSection[] = [
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
    { to: "/comms", label: "All Messages", exact: true, icon: Inbox },
  ]},
  { title: "Knowledge", items: [
    { to: "/knowledge", label: "Browse", icon: Compass },
    { to: "/docs", label: "Documentation", icon: FileText },
  ]},
  { title: "Marketplace", items: [
    { to: "/gateway/marketplace", label: "Plugins", icon: Store },
    { to: "/magic-apps/admin", label: "MagicApps", icon: Sparkles },
    { to: "/hf-marketplace", label: "HF Models", icon: Cpu },
  ]},
  { title: "Gateway", items: [
    { to: "/gateway/workflows", label: "Workflows", icon: GitBranch },
    { to: "/gateway/logs", label: "Logs", icon: ScrollText },
    { to: "/gateway/onboarding", label: "Onboarding", icon: Rocket },
  ]},
  { title: "Settings", items: [
    { to: "/settings", label: "Settings", icon: SlidersHorizontal },
  ]},
];

const domainRouteMap: Record<string, string> = {
  impactinomics: "", projects: "/projects", comms: "/comms",
  knowledge: "/knowledge", gateway: "/gateway", settings: "/settings", system: "/system",
};

const domainTitleMap: Record<string, string> = {
  impactinomics: "Overview", projects: "Projects", comms: "Communication",
  knowledge: "Knowledge", gateway: "Gateway", settings: "Settings", system: "System",
};

export interface AppSidebarProps {
  isMobile: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function AppSidebar({ isMobile, mobileOpen, onMobileClose }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;
  const [pluginSections, setPluginSections] = useState<PluginSidebarSection[]>([]);
  const [pluginPages, setPluginPages] = useState<PluginDashboardPage[]>([]);
  const [pluginDomains, setPluginDomains] = useState<PluginDashboardDomain[]>([]);

  useEffect(() => {
    fetchPluginSidebar().then(setPluginSections).catch(() => {});
    fetchPluginDashboardPages().then(setPluginPages).catch(() => {});
    fetchPluginDashboardDomains().then(setPluginDomains).catch(() => {});
  }, []);

  const sections = useMemo(() => {
    const baseSections: (NavSection & { position: number })[] = [
      ...builtinSections.map((s, i) => ({ ...s, position: (i + 1) * 10 })),
      ...pluginSections.map((ps) => ({
        title: ps.title,
        items: ps.items.map((item) => ({ to: item.to, label: item.label, exact: item.exact })),
        position: ps.position ?? 50,
      })),
      ...pluginDomains.map((d) => ({
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
      return { ...section, items };
    }).sort((a, b) => a.position - b.position);
  }, [pluginSections, pluginDomains, pluginPages]);

  const isAdminActive = currentPath === "/admin" || currentPath.startsWith("/admin/");

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
        {sections.map((section) => (
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

        {/* Admin button */}
        <div className="border-t border-border mt-4 pt-2 px-3">
          <MobileMenu.Item
            active={isAdminActive}
            icon={<Shield className="w-4 h-4" />}
            onClick={() => { navigate("/admin"); onMobileClose(); }}
          >
            Admin
          </MobileMenu.Item>
        </div>
      </MobileMenu.Flyout>
    );
  }

  // ---------------------------------------------------------------------------
  // Desktop — collapsible Sidebar
  // ---------------------------------------------------------------------------

  return (
    <Sidebar defaultCollapsed={false} collapseMode="icons" data-testid="app-sidebar">
      {/* Logo */}
      <div className="px-3 py-3 border-b border-border">
        <Link to="/" className="flex items-center gap-2 text-foreground no-underline">
          <img src="/spore-seed-clear.svg" alt="" width={24} height={24} className="shrink-0" />
          <span className="text-sm font-bold">Aionima</span>
        </Link>
      </div>

      {/* Nav sections */}
      {sections.map((section) => (
        <Sidebar.Group key={section.title} label={section.title}>
          {section.items.map((item) => {
            const isActive = item.exact
              ? currentPath === item.to
              : currentPath === item.to || currentPath.startsWith(item.to + "/");
            const Icon = item.icon;
            return (
              <Sidebar.Item
                key={item.to}
                active={isActive}
                icon={Icon ? <Icon className="w-4 h-4" /> : undefined}
                onClick={() => navigate(item.to)}
              >
                {item.label}
              </Sidebar.Item>
            );
          })}
        </Sidebar.Group>
      ))}

      {/* Admin + Collapse at bottom */}
      <div className="mt-auto border-t border-border">
        <Sidebar.Item
          active={isAdminActive}
          icon={<Shield className="w-4 h-4" />}
          onClick={() => navigate("/admin")}
        >
          Admin
        </Sidebar.Item>
        <Sidebar.Toggle />
      </div>
    </Sidebar>
  );
}
