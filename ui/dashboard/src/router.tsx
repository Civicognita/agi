/**
 * Router configuration — React Router v7 with nested layout.
 */

import { createBrowserRouter, Navigate } from "react-router";
import RootLayout from "./routes/root.js";
import OverviewPage from "./routes/overview.js";
import ProjectsPage from "./routes/projects.js";
import ProjectDetailPage from "./routes/project-detail.js";
import COAPage from "./routes/coa.js";
import LogsPage from "./routes/logs.js";
import EntityPage from "./routes/entity.js";
import ResourcesPage from "./routes/resources.js";
import WorkflowsPage from "./routes/workflows.js";
import CommsPage from "./routes/comms.js";
import CommsTelegramPage from "./routes/comms-telegram.js";
import CommsDiscordPage from "./routes/comms-discord.js";
import CommsGmailPage from "./routes/comms-gmail.js";
import CommsSignalPage from "./routes/comms-signal.js";
import CommsWhatsAppPage from "./routes/comms-whatsapp.js";
import ServicesPage from "./routes/services.js";
import AdminPage from "./routes/admin.js";
import KnowledgePage from "./routes/knowledge.js";
import DocsPage from "./routes/docs.js";
import SettingsLayout from "./routes/settings-layout.js";
import SettingsGatewayPage from "./routes/settings-gateway.js";
import SettingsDynamicPage from "./routes/settings-dynamic.js";
import { PluginPageResolver } from "./components/PluginPageResolver.js";
import MarketplacePage from "./routes/marketplace.js";
import { OnboardingPage } from "./routes/onboarding.js";
import { GatewayOnboardingPage } from "./routes/gateway-onboarding.js";
import ReportsPage from "./routes/reports.js";
import ReportDetailPage from "./routes/report-detail.js";
import ChangelogPage from "./routes/system-changelog.js";
import IncidentsPage from "./routes/system-incidents.js";
import VendorsPage from "./routes/system-vendors.js";
import BackupsPage from "./routes/system-backups.js";
import SecuritySettingsPage from "./routes/settings-security.js";
import SystemSecurityPage from "./routes/system-security.js";
import IdentityServicePage from "./routes/system-identity.js";
import MagicAppsPage from "./routes/magic-apps.js";
import MagicAppDetailPage from "./routes/magic-app-detail.js";
import MagicAppsAdminPage from "./routes/magic-apps-admin.js";
import MAppEditorPage from "./routes/mapp-editor.js";
import { RouteErrorBoundary } from "./components/ErrorBoundary.js";

export const router = createBrowserRouter([
  {
    path: "/onboarding",
    element: <OnboardingPage />,
  },
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "coa", element: <COAPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "reports/:coaReqId", element: <ReportDetailPage /> },
      { path: "entity/:id", element: <EntityPage /> },
      { path: "projects", element: <ProjectsPage /> },
{ path: "projects/:slug", element: <ProjectDetailPage /> },
      // MagicApps
      { path: "magic-apps", element: <MagicAppsPage /> },
      { path: "magic-apps/admin", element: <MagicAppsAdminPage /> },
      { path: "magic-apps/editor", element: <MAppEditorPage /> },
      { path: "magic-apps/editor/:id", element: <MAppEditorPage /> },
      { path: "magic-apps/:id", element: <MagicAppDetailPage /> },
      // Knowledge
      { path: "knowledge", element: <KnowledgePage /> },
      // Documentation
      { path: "docs", element: <DocsPage /> },
      // Gateway
      { path: "gateway/plugins", element: <Navigate to="/gateway/marketplace" replace /> },
      { path: "gateway/workflows", element: <WorkflowsPage /> },
      { path: "gateway/logs", element: <LogsPage /> },
      { path: "gateway/marketplace", element: <MarketplacePage /> },
      { path: "gateway/onboarding", element: <GatewayOnboardingPage /> },
      // Redirect old settings path
      { path: "gateway/settings", element: <Navigate to="/settings/gateway" replace /> },
      // Settings (top-level section with sub-pages)
      {
        path: "settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="/settings/gateway" replace /> },
          { path: "gateway", element: <SettingsGatewayPage /> },
          { path: "security", element: <SecuritySettingsPage /> },
          { path: "plugins", element: <Navigate to="/settings/gateway" replace /> },
          { path: ":pageId", element: <SettingsDynamicPage /> },
        ],
      },
      // System (trimmed)
      { path: "system", element: <ResourcesPage /> },
      { path: "system/services", element: <ServicesPage /> },
      { path: "system/admin", element: <AdminPage /> },
      { path: "system/changelog", element: <ChangelogPage /> },
      { path: "system/incidents", element: <IncidentsPage /> },
      { path: "system/vendors", element: <VendorsPage /> },
      { path: "system/backups", element: <BackupsPage /> },
      { path: "system/security", element: <SystemSecurityPage /> },
      { path: "system/identity", element: <IdentityServicePage /> },
      // Redirects: old system/* paths → new locations
      { path: "system/plugins", element: <Navigate to="/gateway/marketplace" replace /> },
      { path: "system/workflows", element: <Navigate to="/gateway/workflows" replace /> },
      { path: "system/logs", element: <Navigate to="/gateway/logs" replace /> },
      { path: "system/settings", element: <Navigate to="/settings/gateway" replace /> },
      { path: "system/comms", element: <Navigate to="/comms" replace /> },
      // Communication
      { path: "comms", element: <CommsPage /> },
      { path: "comms/telegram", element: <CommsTelegramPage /> },
      { path: "comms/discord", element: <CommsDiscordPage /> },
      { path: "comms/gmail", element: <CommsGmailPage /> },
      { path: "comms/signal", element: <CommsSignalPage /> },
      { path: "comms/whatsapp", element: <CommsWhatsAppPage /> },
      { path: "*", element: <PluginPageResolver /> },
    ],
  },
]);
