/**
 * Impact Dashboard — Public API
 *
 * Re-exports components, hooks, and types for embedding the dashboard
 * in other applications or using as a library.
 */

// Components
export { App } from "./App.js";
export { OverviewCards } from "./components/OverviewCards.js";
export { TimelineChart } from "./components/TimelineChart.js";
export { BreakdownChart } from "./components/BreakdownChart.js";
export { EntityProfile } from "./components/EntityProfile.js";
export { COAExplorer } from "./components/COAExplorer.js";
export { ActivityFeed } from "./components/ActivityFeed.js";

// Hooks
export { useOverview, useDashboardWS } from "./hooks.js";
export { useTheme } from "./lib/theme-provider.js";

// API client
export {
  fetchOverview,
  fetchTimeline,
  fetchBreakdown,
  fetchLeaderboard,
  fetchEntityProfile,
  fetchCOAEntries,
} from "./api.js";

// Types
export type {
  ActivityEntry,
  BreakdownDimension,
  BreakdownSlice,
  COAExplorerEntry,
  DashboardEvent,
  DashboardOverview,
  EntityImpactProfile,
  ImpactDomain,
  LeaderboardEntry,
  ThemeMode,
  TimeBucket,
  TimelineBucket,
} from "./types.js";
