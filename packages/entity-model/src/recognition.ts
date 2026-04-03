/**
 * Recognition Event System — Task #211
 *
 * Entity A recognizes Entity B's contribution:
 * - Agent validates against COA records for both entities
 * - 0BOOL classification of the contribution
 * - Cross-COA link created (A.COA → B.COA)
 * - 0BONUS recalculated for B's relevant interactions
 * - Small 0BONUS for A (accurate recognition incentive)
 * - Recognition visible on B's public profile if consented
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A recognition event between two entities. */
export interface RecognitionEvent {
  id: string;
  /** Entity giving recognition. */
  recognizerId: string;
  recognizerGeid: string;
  /** Entity receiving recognition. */
  recipientId: string;
  recipientGeid: string;
  /** Description of the recognized contribution. */
  contribution: string;
  /** Domain of the contribution (one of 6 Civicognita domains). */
  domain: RecognitionDomain;
  /** 0BOOL classification label. */
  boolLabel: string;
  /** COA fingerprint of the recognizer's action. */
  recognizerCoa: string;
  /** COA fingerprint of the recipient's contribution being recognized. */
  recipientCoa: string;
  /** 0BONUS awarded to the recipient. */
  recipientBonus: number;
  /** 0BONUS awarded to the recognizer (accurate recognition incentive). */
  recognizerBonus: number;
  /** Whether the recipient consents to public display. */
  publicConsent: boolean;
  /** Originating node. */
  sourceNode: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Status of the recognition. */
  status: RecognitionStatus;
}

/** The six Civicognita domains. */
export type RecognitionDomain =
  | "governance"
  | "community"
  | "innovation"
  | "operations"
  | "knowledge"
  | "technology";

/** Recognition lifecycle status. */
export type RecognitionStatus = "pending" | "validated" | "rejected" | "disputed";

/** Parameters for creating a recognition event. */
export interface CreateRecognitionParams {
  id: string;
  recognizerId: string;
  recognizerGeid: string;
  recipientId: string;
  recipientGeid: string;
  contribution: string;
  domain: RecognitionDomain;
  boolLabel: string;
  recognizerCoa: string;
  recipientCoa: string;
  sourceNode: string;
  publicConsent?: boolean;
}

/** 0BONUS rates for recognition. */
export const RECOGNITION_BONUS = {
  /** Base 0BONUS for the recipient. */
  recipientBase: 0.05,
  /** Recognizer incentive (smaller — accurate recognition reward). */
  recognizerIncentive: 0.01,
  /** Maximum bonus cap per recognition event. */
  maxBonus: 0.50,
} as const;

// ---------------------------------------------------------------------------
// Recognition Manager
// ---------------------------------------------------------------------------

/**
 * Manages recognition events between entities.
 */
export class RecognitionManager {
  private readonly events = new Map<string, RecognitionEvent>();
  /** Index: recipientId → recognition IDs. */
  private readonly recipientIndex = new Map<string, string[]>();
  /** Index: recognizerId → recognition IDs. */
  private readonly recognizerIndex = new Map<string, string[]>();

  /**
   * Create a recognition event.
   *
   * Recognizer must be a different entity than recipient.
   */
  create(params: CreateRecognitionParams): RecognitionEvent {
    if (params.recognizerId === params.recipientId) {
      throw new Error("Cannot recognize yourself");
    }

    const event: RecognitionEvent = {
      id: params.id,
      recognizerId: params.recognizerId,
      recognizerGeid: params.recognizerGeid,
      recipientId: params.recipientId,
      recipientGeid: params.recipientGeid,
      contribution: params.contribution,
      domain: params.domain,
      boolLabel: params.boolLabel,
      recognizerCoa: params.recognizerCoa,
      recipientCoa: params.recipientCoa,
      recipientBonus: RECOGNITION_BONUS.recipientBase,
      recognizerBonus: RECOGNITION_BONUS.recognizerIncentive,
      publicConsent: params.publicConsent ?? false,
      sourceNode: params.sourceNode,
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    this.events.set(params.id, event);
    this.indexEvent(event);

    return event;
  }

  /**
   * Validate a pending recognition after COA verification.
   */
  validate(eventId: string, recipientBonus?: number): RecognitionEvent {
    const event = this.getOrThrow(eventId);
    if (event.status !== "pending") {
      throw new Error(`Cannot validate: status is "${event.status}"`);
    }

    event.status = "validated";
    if (recipientBonus !== undefined) {
      event.recipientBonus = Math.min(recipientBonus, RECOGNITION_BONUS.maxBonus);
    }

    return event;
  }

  /**
   * Reject a recognition event (failed COA validation).
   */
  reject(eventId: string): RecognitionEvent {
    const event = this.getOrThrow(eventId);
    if (event.status !== "pending") {
      throw new Error(`Cannot reject: status is "${event.status}"`);
    }

    event.status = "rejected";
    event.recipientBonus = 0;
    event.recognizerBonus = 0;

    return event;
  }

  /**
   * Get recognitions received by an entity.
   */
  getReceivedRecognitions(recipientId: string, status?: RecognitionStatus): RecognitionEvent[] {
    const ids = this.recipientIndex.get(recipientId) ?? [];
    const events = ids.map(id => this.events.get(id)).filter((e): e is RecognitionEvent => e !== undefined);
    return status ? events.filter(e => e.status === status) : events;
  }

  /**
   * Get recognitions given by an entity.
   */
  getGivenRecognitions(recognizerId: string): RecognitionEvent[] {
    const ids = this.recognizerIndex.get(recognizerId) ?? [];
    return ids.map(id => this.events.get(id)).filter((e): e is RecognitionEvent => e !== undefined);
  }

  /**
   * Get public recognitions for an entity's profile.
   */
  getPublicProfile(recipientId: string): RecognitionEvent[] {
    return this.getReceivedRecognitions(recipientId, "validated")
      .filter(e => e.publicConsent);
  }

  /** Get a single recognition event. */
  get(eventId: string): RecognitionEvent | null {
    return this.events.get(eventId) ?? null;
  }

  private getOrThrow(eventId: string): RecognitionEvent {
    const event = this.events.get(eventId);
    if (!event) throw new Error(`Recognition event not found: ${eventId}`);
    return event;
  }

  private indexEvent(event: RecognitionEvent): void {
    if (!this.recipientIndex.has(event.recipientId)) {
      this.recipientIndex.set(event.recipientId, []);
    }
    this.recipientIndex.get(event.recipientId)!.push(event.id);

    if (!this.recognizerIndex.has(event.recognizerId)) {
      this.recognizerIndex.set(event.recognizerId, []);
    }
    this.recognizerIndex.get(event.recognizerId)!.push(event.id);
  }
}
