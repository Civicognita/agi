/**
 * AppSidebar — perspective-based sidebar navigation.
 *
 * Two perspectives: Frontend (user-facing) and Backend (admin/config).
 * A segmented control at the top switches between them. The active perspective
 * is auto-detected from the current route, so deep-linking works seamlessly.
 * Plugin-registered sidebar sections are merged at their configured positions.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { fetchPluginSidebar, fetchPluginDashboardPages, fetchPluginDashboardDomains } from "../api.js";
import type { PluginSidebarSection, PluginDashboardPage, PluginDashboardDomain } from "../types.js";
import type { LucideIcon } from "lucide-react";
import {
  Folders,
  Inbox,
  LayoutDashboard,
  Link as LinkIcon,
  FileBarChart,
  Compass,
  FileText,
  GitBranch,
  Store,
  ScrollText,
  Rocket,
  SlidersHorizontal,
  Activity,
  Blocks,
  ShieldHalf,
  ShieldCheck,
  AlertTriangle,
  Building2,
  HardDrive,
  Fingerprint,
} from "lucide-react";

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

type Perspective = "frontend" | "backend";

interface NavSectionWithPerspective extends NavSection {
  perspective: Perspective;
}

const builtinSections: NavSectionWithPerspective[] = [
  // ── FRONTEND ──
  {
    perspective: "frontend",
    title: "Projects",
    items: [
      { to: "/projects", label: "All Projects", icon: Folders },
    ],
  },
  {
    perspective: "frontend",
    title: "Communication",
    items: [
      { to: "/comms", label: "All Messages", exact: true, icon: Inbox },
    ],
  },
  {
    perspective: "frontend",
    title: "Impactinomics",
    items: [
      { to: "/", label: "Overview", exact: true, icon: LayoutDashboard },
      { to: "/coa", label: "COA Explorer", icon: LinkIcon },
      { to: "/reports", label: "Reports", icon: FileBarChart },
    ],
  },
  {
    perspective: "frontend",
    title: "Knowledge",
    items: [
      { to: "/knowledge", label: "Browse", icon: Compass },
      { to: "/docs", label: "Documentation", icon: FileText },
    ],
  },
  // ── BACKEND ──
  {
    perspective: "backend",
    title: "Gateway",
    items: [
      { to: "/gateway/workflows", label: "Workflows", icon: GitBranch },
      { to: "/gateway/marketplace", label: "Marketplace", icon: Store },
      { to: "/gateway/logs", label: "Logs", icon: ScrollText },
      { to: "/gateway/onboarding", label: "Onboarding", icon: Rocket },
    ],
  },
  {
    perspective: "backend",
    title: "Settings",
    items: [
      { to: "/settings", label: "Settings", icon: SlidersHorizontal },
    ],
  },
  {
    perspective: "backend",
    title: "System",
    items: [
      { to: "/system", label: "Resources", exact: true, icon: Activity },
      { to: "/system/services", label: "Services", icon: Blocks },
      { to: "/system/admin", label: "Admin", icon: ShieldHalf },
      { to: "/system/changelog", label: "Changelog", icon: ScrollText },
      { to: "/system/incidents", label: "Incidents", icon: AlertTriangle },
      { to: "/system/vendors", label: "Vendors", icon: Building2 },
      { to: "/system/backups", label: "Backups", icon: HardDrive },
      { to: "/system/security", label: "Security", icon: ShieldCheck },
      { to: "/system/identity", label: "Identity", icon: Fingerprint },
    ],
  },
];

/** Route prefixes that belong to the backend perspective. */
const BACKEND_PREFIXES = ["/gateway", "/settings", "/system"];

function detectPerspective(pathname: string): Perspective {
  for (const prefix of BACKEND_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return "backend";
  }
  return "frontend";
}

// Domain-to-route mapping for injecting plugin pages into existing sections
const domainRouteMap: Record<string, string> = {
  impactinomics: "",
  projects: "/projects",
  comms: "/comms",
  knowledge: "/knowledge",
  gateway: "/gateway",
  settings: "/settings",
  system: "/system",
};

// Domain-to-title mapping for identifying built-in sections
const domainTitleMap: Record<string, string> = {
  impactinomics: "Impactinomics",
  projects: "Projects",
  comms: "Communication",
  knowledge: "Knowledge",
  gateway: "Gateway",
  settings: "Settings",
  system: "System",
};

interface AppSidebarProps {
  isMobile: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function AppSidebar({ isMobile, mobileOpen, onMobileClose }: AppSidebarProps) {
  const location = useLocation();
  const currentPath = location.pathname;
  const [pluginSections, setPluginSections] = useState<PluginSidebarSection[]>([]);
  const [pluginPages, setPluginPages] = useState<PluginDashboardPage[]>([]);
  const [pluginDomains, setPluginDomains] = useState<PluginDashboardDomain[]>([]);

  // Auto-detect perspective from route, allow manual override
  const detected = detectPerspective(currentPath);
  const [manualPerspective, setManualPerspective] = useState<Perspective | null>(null);
  const perspective = manualPerspective ?? detected;

  // Reset manual override when route changes to the other perspective
  useEffect(() => {
    setManualPerspective(null);
  }, [detected]);

  useEffect(() => {
    fetchPluginSidebar().then(setPluginSections).catch(() => {});
    fetchPluginDashboardPages().then(setPluginPages).catch(() => {});
    fetchPluginDashboardDomains().then(setPluginDomains).catch(() => {});
  }, []);

  const sections = useMemo(() => {
    // Merge built-in sections with plugin sections
    const baseSections: NavSectionWithPerspective[] = [
      ...builtinSections.map((s, i) => ({ ...s, position: (i + 1) * 10 })),
      ...pluginSections.map((ps) => ({
        perspective: "backend" as Perspective,
        title: ps.title,
        items: ps.items.map((item) => ({ to: item.to, label: item.label, exact: item.exact })),
        position: ps.position ?? 50,
      })),
      // Plugin domains become entirely new sidebar sections
      ...pluginDomains.map((d) => ({
        perspective: "frontend" as Perspective,
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

    // Inject plugin dashboard pages into their target domain sections
    const pageItemsByDomain = new Map<string, NavItem[]>();
    for (const page of pluginPages) {
      const prefix = domainRouteMap[page.domain];
      if (prefix === undefined) continue;
      const items = pageItemsByDomain.get(page.domain) ?? [];
      items.push({
        to: `${prefix}/${page.routePath}`,
        label: page.label,
      });
      pageItemsByDomain.set(page.domain, items);
    }

    return baseSections.map((section) => {
      const domainEntry = Object.entries(domainTitleMap).find(([, title]) => title === section.title);
      const domain = domainEntry?.[0];

      let items = [...section.items];

      if (domain) {
        const extraItems = pageItemsByDomain.get(domain);
        if (extraItems) {
          items = [...items, ...extraItems];
        }
      }

      return { ...section, items };
    }).sort((a, b) => (a.position ?? 100) - (b.position ?? 100));
  }, [pluginSections, pluginDomains, pluginPages]);

  const visibleSections = sections.filter((s) => s.perspective === perspective);

  if (isMobile) {
    if (!mobileOpen) return null;

    return (
      <div className="fixed inset-0 z-[200]">
        <div className="absolute inset-0 bg-black/40" onClick={onMobileClose} />
        <aside className="w-72 h-dvh bg-card border-r border-border flex flex-col fixed left-0 top-0 z-[201] transition-transform duration-300" style={{ transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)' }} data-testid="app-sidebar">
          {/* Logo */}
          <div className="px-4 py-4 border-b border-border">
            <Link to="/" className="flex items-center gap-2 text-lg font-bold text-foreground no-underline" onClick={onMobileClose}>
              <img src="/spore-seed-clear.svg" alt="" width={28} height={28} className="shrink-0" />
              Aionima
            </Link>
          </div>

          {/* Perspective switcher */}
          <div className="px-3 pt-3 pb-1">
            <div className="flex rounded-lg bg-secondary p-0.5">
              <button
                onClick={() => setManualPerspective("frontend")}
                className={cn(
                  "flex-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer border-none",
                  perspective === "frontend"
                    ? "bg-card text-foreground shadow-sm"
                    : "bg-transparent text-muted-foreground hover:text-foreground",
                )}
                data-testid="perspective-frontend"
              >
                Frontend
              </button>
              <button
                onClick={() => setManualPerspective("backend")}
                className={cn(
                  "flex-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer border-none",
                  perspective === "backend"
                    ? "bg-card text-foreground shadow-sm"
                    : "bg-transparent text-muted-foreground hover:text-foreground",
                )}
                data-testid="perspective-backend"
              >
                Backend
              </button>
            </div>
          </div>

          {/* Nav sections — only shows the active perspective */}
          <nav className="flex-1 overflow-y-auto py-2">
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
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={onMobileClose}
                      className={cn(
                        "flex items-center gap-2 mx-2 px-3 py-2.5 md:py-1.5 rounded-lg text-[13px] no-underline transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "text-foreground hover:bg-secondary",
                      )}
                      data-testid={`nav-${section.title.toLowerCase().replace(/\s+/g, "-")}-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {Icon && <Icon className="w-4 h-4 shrink-0" />}
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

        </aside>
      </div>
    );
  }

  return (
    <aside className="w-56 shrink-0 bg-card border-r border-border h-screen sticky top-0 flex flex-col" data-testid="app-sidebar">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-border">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold text-foreground no-underline">
          <img src="/spore-seed-clear.svg" alt="" width={28} height={28} className="shrink-0" />
          Aionima
        </Link>
      </div>

      {/* Perspective switcher */}
      <div className="px-3 pt-3 pb-1">
        <div className="flex rounded-lg bg-secondary p-0.5">
          <button
            onClick={() => setManualPerspective("frontend")}
            className={cn(
              "flex-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer border-none",
              perspective === "frontend"
                ? "bg-card text-foreground shadow-sm"
                : "bg-transparent text-muted-foreground hover:text-foreground",
            )}
            data-testid="perspective-frontend"
          >
            Frontend
          </button>
          <button
            onClick={() => setManualPerspective("backend")}
            className={cn(
              "flex-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer border-none",
              perspective === "backend"
                ? "bg-card text-foreground shadow-sm"
                : "bg-transparent text-muted-foreground hover:text-foreground",
            )}
            data-testid="perspective-backend"
          >
            Backend
          </button>
        </div>
      </div>

      {/* Nav sections — only shows the active perspective */}
      <nav className="flex-1 overflow-y-auto py-2">
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
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex items-center gap-2 mx-2 px-3 py-2.5 md:py-1.5 rounded-lg text-[13px] no-underline transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-foreground hover:bg-secondary",
                  )}
                  data-testid={`nav-${section.title.toLowerCase().replace(/\s+/g, "-")}-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {Icon && <Icon className="w-4 h-4 shrink-0" />}
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

    </aside>
  );
}
