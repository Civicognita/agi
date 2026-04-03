/**
 * Legal Compliance Framework — Task #223
 *
 * Type definitions and templates for:
 * - Terms of Service (0R seals = non-legal credentials)
 * - Data Processing Agreement (DPA) template
 * - Cross-jurisdiction data flow documentation
 * - Impact claim liability disclaimers
 * - GDPR right-to-erasure interpretation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Compliance document types. */
export type ComplianceDocType =
  | "terms_of_service"
  | "data_processing_agreement"
  | "privacy_policy"
  | "data_flow_documentation"
  | "impact_liability_disclaimer"
  | "gdpr_erasure_memo"
  | "seal_credential_positioning";

/** Compliance document metadata. */
export interface ComplianceDocument {
  type: ComplianceDocType;
  version: string;
  effectiveDate: string;
  lastReviewedDate: string;
  status: "draft" | "review" | "approved" | "active";
  sections: ComplianceSection[];
}

export interface ComplianceSection {
  id: string;
  title: string;
  content: string;
  legalReviewRequired: boolean;
  reviewStatus: "pending" | "reviewed" | "approved";
}

/** Data flow record for cross-jurisdiction compliance. */
export interface DataFlowRecord {
  /** What data crosses node boundaries. */
  dataType: string;
  /** Source jurisdiction. */
  sourceJurisdiction: string;
  /** Destination jurisdiction. */
  destinationJurisdiction: string;
  /** Why this data crosses boundaries. */
  purpose: string;
  /** Legal basis for transfer. */
  legalBasis: string;
  /** Data minimization measures. */
  minimization: string;
}

/** Seal credential positioning statement. */
export interface SealPositioning {
  /** What 0R seals ARE. */
  sealIs: string[];
  /** What 0R seals ARE NOT. */
  sealIsNot: string[];
  /** External use disclaimer. */
  externalUseDisclaimer: string;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** Terms of Service — Key sections template. */
export const TOS_TEMPLATE: ComplianceDocument = {
  type: "terms_of_service",
  version: "0.1.0-draft",
  effectiveDate: "",
  lastReviewedDate: "",
  status: "draft",
  sections: [
    {
      id: "seal-positioning",
      title: "0R Seal Credentials",
      content:
        "0R seals are internal verification markers within the Aionima network. " +
        "They represent a record of verified impact contributions as assessed by the " +
        "network's automated and peer-review systems. 0R seals are NOT legal " +
        "certifications, professional credentials, government-issued documents, or " +
        "guarantees of any kind. Use of 0R seal data outside the Aionima network " +
        "is at the user's own risk. Civicognita makes no representations about the " +
        "suitability of 0R seals for any external purpose.",
      legalReviewRequired: true,
      reviewStatus: "pending",
    },
    {
      id: "data-handling",
      title: "Data Collection and Processing",
      content:
        "The platform collects interaction data to generate Chain of Accountability " +
        "(COA) records. Users may request deletion of personal data per GDPR Article " +
        "17. Upon deletion, COA chain records are anonymized (entity references " +
        "replaced with [REDACTED]) while preserving cryptographic chain integrity.",
      legalReviewRequired: true,
      reviewStatus: "pending",
    },
    {
      id: "impact-claims",
      title: "Impact Claim Liability",
      content:
        "Impact scores ($imp) are algorithmically computed based on observed " +
        "interactions and peer endorsements. Civicognita does not guarantee the " +
        "accuracy, completeness, or real-world validity of any impact measurement. " +
        "Impact scores are internal metrics and should not be relied upon for " +
        "financial, professional, or legal decisions.",
      legalReviewRequired: true,
      reviewStatus: "pending",
    },
    {
      id: "federation",
      title: "Federated Network",
      content:
        "The platform operates as a federated network of independently operated " +
        "nodes. Civicognita does not control third-party node operators and is not " +
        "responsible for their data handling practices. Users should verify the " +
        "privacy policies of individual node operators.",
      legalReviewRequired: true,
      reviewStatus: "pending",
    },
  ],
};

/** DPA template — Key sections. */
export const DPA_TEMPLATE: ComplianceDocument = {
  type: "data_processing_agreement",
  version: "0.1.0-draft",
  effectiveDate: "",
  lastReviewedDate: "",
  status: "draft",
  sections: [
    {
      id: "scope",
      title: "Scope of Processing",
      content:
        "The Processor shall process personal data only on documented instructions " +
        "from the Controller, including transfers to third countries or international " +
        "organizations, unless required by EU or Member State law.",
      legalReviewRequired: true,
      reviewStatus: "pending",
    },
    {
      id: "sub-processors",
      title: "Sub-processors",
      content:
        "Federated nodes act as independent controllers, not sub-processors. " +
        "Data shared between nodes is limited to: entity GEIDs (pseudonymous), " +
        "COA fingerprints (hashed), governance votes, and co-verification claims.",
      legalReviewRequired: true,
      reviewStatus: "pending",
    },
    {
      id: "data-retention",
      title: "Data Retention and Deletion",
      content:
        "Personal data is retained while the entity account is active. Upon " +
        "deletion request, personal data is removed within 30 days. Anonymized " +
        "COA chain records are retained indefinitely for chain integrity.",
      legalReviewRequired: true,
      reviewStatus: "pending",
    },
    {
      id: "breach-notification",
      title: "Breach Notification",
      content:
        "The Processor shall notify the Controller of a personal data breach " +
        "without undue delay and in any event within 72 hours of becoming aware " +
        "of the breach.",
      legalReviewRequired: true,
      reviewStatus: "pending",
    },
  ],
};

/** Cross-jurisdiction data flows. */
export const DATA_FLOWS: DataFlowRecord[] = [
  {
    dataType: "Entity GEID (pseudonymous identifier)",
    sourceJurisdiction: "Origin node jurisdiction",
    destinationJurisdiction: "Peer node jurisdiction",
    purpose: "Entity lookup and cross-node verification",
    legalBasis: "Legitimate interest (Article 6(1)(f) GDPR)",
    minimization: "Only GEID shared; no personal data attached",
  },
  {
    dataType: "COA fingerprints (cryptographic hashes)",
    sourceJurisdiction: "Origin node jurisdiction",
    destinationJurisdiction: "Peer node jurisdiction",
    purpose: "Chain of Accountability relay for impact tracking",
    legalBasis: "Legitimate interest (Article 6(1)(f) GDPR)",
    minimization: "Only fingerprints and scores; no raw content",
  },
  {
    dataType: "Governance votes",
    sourceJurisdiction: "Voter's node jurisdiction",
    destinationJurisdiction: "All participating nodes",
    purpose: "Decentralized governance decision-making",
    legalBasis: "Consent (Article 6(1)(a) GDPR)",
    minimization: "Vote + voter GEID only; no additional PII",
  },
  {
    dataType: "Co-verification claims",
    sourceJurisdiction: "Verifying node jurisdiction",
    destinationJurisdiction: "Requesting node jurisdiction",
    purpose: "Multi-node entity verification",
    legalBasis: "Consent (Article 6(1)(a) GDPR)",
    minimization: "Claim status and signatures only",
  },
];

/** 0R Seal positioning statement. */
export const SEAL_POSITIONING: SealPositioning = {
  sealIs: [
    "A record of verified impact contributions within the Aionima network",
    "An internal verification marker backed by cryptographic signatures",
    "A peer-reviewed assessment of documented work and impact",
    "A component of the Chain of Accountability (COA) system",
  ],
  sealIsNot: [
    "A legal certification or professional credential",
    "A government-issued document or license",
    "A guarantee of competence, quality, or future performance",
    "A financial instrument or asset",
    "A substitute for professional qualifications required by law",
  ],
  externalUseDisclaimer:
    "0R seals are designed for use within the Aionima network. Any use of " +
    "0R seal data, scores, or verification status outside the network is " +
    "entirely at the user's own risk. Civicognita expressly disclaims any " +
    "liability arising from external reliance on 0R seal data.",
};

// ---------------------------------------------------------------------------
// Compliance check
// ---------------------------------------------------------------------------

/** Check which compliance documents still need legal review. */
export function getComplianceGaps(
  documents: ComplianceDocument[],
): { document: string; unreviewedSections: string[] }[] {
  const gaps: { document: string; unreviewedSections: string[] }[] = [];

  for (const doc of documents) {
    const unreviewed = doc.sections
      .filter(s => s.legalReviewRequired && s.reviewStatus !== "approved")
      .map(s => s.title);

    if (unreviewed.length > 0) {
      gaps.push({ document: doc.type, unreviewedSections: unreviewed });
    }
  }

  return gaps;
}
