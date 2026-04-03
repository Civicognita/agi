// Entity Classification System — from core/ENTITY.md

/** Top-level entity domain */
export type EntityDomain = "#" | "$" | "@";

/** Entity subtypes — sentient beings capable of self-determination */
export type EntitySubtype =
  | "#E" // Individual/Proper Entity
  | "#O" // Organization
  | "#T" // Team
  | "#F" // Family
  | "#A"; // Artificial Sentient (threshold undefined)

/** Resource subtypes — products, services, assets */
export type ResourceSubtype =
  | "$A" // App/Digital Product
  | "$S" // Service
  | "$T"; // Token/Currency

/** Node subtypes — temporal anchors */
export type NodeSubtype = "@A"; // Age

/** All classification subtypes */
export type ClassificationSubtype =
  | EntitySubtype
  | ResourceSubtype
  | NodeSubtype;

/** Verification tier for entities */
export type VerificationTier = "unverified" | "verified" | "sealed";

/** Core entity record */
export interface Entity {
  id: string; // ULID
  type: "E" | "O" | "T" | "F" | "A";
  displayName: string;
  verificationTier: VerificationTier;
  /** COA-notation alias for fingerprints, e.g. "#E0", "#O1". Auto-generated. */
  coaAlias: string;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

/** Maps a channel identity to an entity */
export interface ChannelAccount {
  id: string;
  entityId: string;
  channel: string; // "telegram", "discord", etc.
  channelUserId: string;
}
