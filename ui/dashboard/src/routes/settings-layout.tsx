/**
 * Settings layout — left sub-nav with search filter + Outlet for settings sub-pages.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useOutletContext } from "react-router";
import { cn } from "@/lib/utils";
import { PageScroll } from "@/components/PageScroll.js";
import { fetchPluginSettingsPages } from "../api.js";
import type { PluginSettingsPage } from "../types.js";
import { useRootContext } from "./root.js";
import { useIsMobile } from "@/hooks.js";

interface SettingsNavItem {
  to: string;
  label: string;
  exact?: boolean;
  isBuiltin?: boolean;
}

/** Context shared with settings child routes. */
export interface SettingsContext {
  configHook: ReturnType<typeof useRootContext>["configHook"];
  pluginPages: PluginSettingsPage[];
}

export function useSettingsContext(): SettingsContext {
  return useOutletContext<SettingsContext>();
}

export default function SettingsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { configHook } = useRootContext();
  const [pluginPages, setPluginPages] = useState<PluginSettingsPage[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetchPluginSettingsPages().then(setPluginPages).catch(() => {});
  }, []);

  const allItems: SettingsNavItem[] = useMemo(() => [
    { to: "/settings/gateway", label: "Gateway", isBuiltin: true },
    { to: "/settings/providers", label: "Providers", isBuiltin: true },
    { to: "/settings/security", label: "Security", isBuiltin: true },
    { to: "/settings/hf", label: "HF Marketplace", isBuiltin: true },
    ...pluginPages.map((p) => ({
      to: `/settings/${p.id}`,
      label: p.label,
    })),
  ], [pluginPages]);

  const filteredItems = useMemo(() => {
    if (!filter.trim()) return allItems;
    const q = filter.toLowerCase();
    return allItems.filter((item) => item.isBuiltin || item.label.toLowerCase().includes(q));
  }, [allItems, filter]);

  const showFilter = pluginPages.length > 5;

  return (
    <PageScroll>
    <div className="flex flex-col md:flex-row gap-6">
      {isMobile ? (
        <select
          value={location.pathname}
          onChange={(e) => navigate(e.target.value)}
          className="w-full mb-4 h-10 rounded-lg border border-input bg-card px-3 text-[13px] text-foreground"
        >
          {filteredItems.map((item) => (
            <option key={item.to} value={item.to}>{item.label}</option>
          ))}
        </select>
      ) : (
        <nav className="w-44 shrink-0">
          <div className="sticky top-4 space-y-1">
            {showFilter && (
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter..."
                className="w-full px-3 py-1.5 mb-2 rounded-lg text-[13px] bg-secondary border-none outline-none text-foreground placeholder:text-muted-foreground"
              />
            )}
            {filteredItems.map((item) => {
              const isActive = item.exact
                ? location.pathname === item.to
                : location.pathname === item.to || location.pathname.startsWith(item.to + "/");
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "block px-3 py-1.5 rounded-lg text-[13px] no-underline transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-foreground hover:bg-secondary",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
            {showFilter && filter && filteredItems.every((i) => i.isBuiltin) && (
              <div className="px-3 py-1 text-[11px] text-muted-foreground">No matches</div>
            )}
          </div>
        </nav>
      )}

      {/* Content area */}
      <div className="flex-1 min-w-0">
        <Outlet context={{ configHook, pluginPages } satisfies SettingsContext} />
      </div>
    </div>
    </PageScroll>
  );
}
