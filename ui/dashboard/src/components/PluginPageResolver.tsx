/**
 * PluginPageResolver — catch-all route component that resolves plugin pages and domains.
 *
 * Matches the current pathname against:
 * 1. Plugin dashboard pages (injected into existing domains)
 * 2. Plugin dashboard domains (new top-level sections)
 *
 * Renders matching page using WidgetRenderer. Falls back to home redirect.
 */

import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { Card } from "@/components/ui/card";
import { WidgetRenderer } from "./WidgetRenderer.js";
import { fetchPluginDashboardPages, fetchPluginDashboardDomains, fetchPluginActions } from "../api.js";
import type { PluginDashboardPage, PluginDashboardDomain, PluginAction, PanelWidget } from "../types.js";

/** Domain-to-route mapping. */
const domainRouteMap: Record<string, string> = {
  impactinomics: "",
  projects: "/projects",
  comms: "/comms",
  knowledge: "/knowledge",
  gateway: "/gateway",
  settings: "/settings",
  system: "/system",
};

interface ResolvedPage {
  label: string;
  description?: string;
  widgets: PanelWidget[];
}

export function PluginPageResolver() {
  const location = useLocation();
  const [pages, setPages] = useState<PluginDashboardPage[]>([]);
  const [domains, setDomains] = useState<PluginDashboardDomain[]>([]);
  const [actions, setActions] = useState<PluginAction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchPluginDashboardPages(),
      fetchPluginDashboardDomains(),
      fetchPluginActions(),
    ])
      .then(([p, d, a]) => {
        setPages(p);
        setDomains(d);
        setActions(a);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  const pathname = location.pathname;

  // Try to match against plugin dashboard pages (existing domains)
  for (const page of pages) {
    const prefix = domainRouteMap[page.domain];
    if (prefix === undefined) continue;
    const fullPath = `${prefix}/${page.routePath}`;
    if (pathname === fullPath) {
      return <PageRenderer page={{ label: page.label, description: page.description, widgets: page.widgets }} actions={actions} />;
    }
  }

  // Try to match against plugin domains
  for (const domain of domains) {
    const prefix = `/${domain.routePrefix}`;
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      const suffix = pathname === prefix ? "" : pathname.slice(prefix.length + 1);
      const page = domain.pages.find((p) =>
        p.isIndex ? suffix === "" : p.routePath === suffix,
      );
      if (page) {
        return <PageRenderer page={{ label: page.label, widgets: page.widgets }} actions={actions} />;
      }
      // Default to index page if exists
      const indexPage = domain.pages.find((p) => p.isIndex);
      if (indexPage && suffix === "") {
        return <PageRenderer page={{ label: indexPage.label, widgets: indexPage.widgets }} actions={actions} />;
      }
    }
  }

  // No match — redirect home
  return <Navigate to="/" replace />;
}

function PageRenderer({ page, actions }: { page: ResolvedPage; actions: PluginAction[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{page.label}</h1>
        {page.description && (
          <p className="text-sm text-muted-foreground mt-1">{page.description}</p>
        )}
      </div>
      <Card className="p-6">
        <WidgetRenderer widgets={page.widgets} actions={actions} />
      </Card>
    </div>
  );
}
