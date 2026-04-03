/**
 * Marketplace Discovery UI — Task #215
 *
 * Responsive web interface for skill marketplace:
 * - Search by domain, NEED type, author, impact correlation
 * - Skill detail pages with endorsements, usage stats, verification status
 * - Install/uninstall flow
 *
 * This is the entry point for the marketplace UI package.
 * Component implementations will follow in Phase 5.
 */

export type {
  SkillListing,
  SkillUsageStats,
  SkillEndorsement,
  SkillVerificationStatus,
  RankingScore,
} from "@aionima/entity-model";

export type { RecognitionDomain } from "@aionima/entity-model";

/** Marketplace UI search parameters. */
export interface MarketplaceSearchParams {
  domain?: string;
  needType?: string;
  author?: string;
  text?: string;
  sortBy?: "relevance" | "installs" | "endorsements" | "recent";
}

/** Marketplace UI view modes. */
export type MarketplaceView = "grid" | "list" | "detail";
