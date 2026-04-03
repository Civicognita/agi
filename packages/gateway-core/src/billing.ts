/**
 * Stripe Billing Integration — Task #191
 *
 * Manages subscription lifecycle for hosted multi-tenant mode.
 * Plan tiers: free, pro ($8/mo), org ($25/seat, 10 min), community ($150/mo).
 *
 * Features:
 * - Stripe Checkout session creation for new subscriptions
 * - Webhook handler for payment events (invoice.paid, subscription updates)
 * - Plan-gated feature enforcement
 * - Usage metering for message counts
 */

import type { PlanTier, PlanLimits, TenantId } from "@aionima/entity-model";
import { getPlanLimits } from "@aionima/entity-model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BillingConfig {
  /** Stripe secret key. */
  stripeSecretKey: string;
  /** Stripe webhook signing secret. */
  webhookSecret: string;
  /** Base URL for checkout success/cancel redirects. */
  baseUrl: string;
  /** Stripe price IDs per plan tier. */
  priceIds: Record<Exclude<PlanTier, "free">, string>;
}

export interface CheckoutParams {
  tenantId: TenantId;
  plan: Exclude<PlanTier, "free">;
  email: string;
  /** Number of seats (org plan only). */
  seats?: number;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CheckoutResult {
  sessionId: string;
  url: string;
}

export interface SubscriptionInfo {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  plan: PlanTier;
  status: SubscriptionStatus;
  currentPeriodEnd: string;
  seats: number;
  cancelAtPeriodEnd: boolean;
}

export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "trialing";

export interface WebhookEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface WebhookResult {
  handled: boolean;
  action?: WebhookAction;
  tenantId?: TenantId;
  plan?: PlanTier;
}

export type WebhookAction =
  | "subscription_created"
  | "subscription_updated"
  | "subscription_canceled"
  | "payment_succeeded"
  | "payment_failed";

export interface UsageRecord {
  tenantId: TenantId;
  messageCount: number;
  periodStart: string;
  periodEnd: string;
}

export interface PlanGateResult {
  allowed: boolean;
  reason?: string;
  limit?: number;
  current?: number;
}

// ---------------------------------------------------------------------------
// Plan pricing (for display purposes)
// ---------------------------------------------------------------------------

export const PLAN_PRICING: Record<PlanTier, { monthlyUsd: number; perSeat: boolean; minSeats: number }> = {
  free: { monthlyUsd: 0, perSeat: false, minSeats: 0 },
  pro: { monthlyUsd: 8, perSeat: false, minSeats: 0 },
  org: { monthlyUsd: 25, perSeat: true, minSeats: 10 },
  community: { monthlyUsd: 150, perSeat: false, minSeats: 0 },
};

// ---------------------------------------------------------------------------
// Billing Manager
// ---------------------------------------------------------------------------

/**
 * Callback interface for billing state changes.
 * The gateway implements this to update tenant records when Stripe events arrive.
 */
export interface BillingCallbacks {
  onSubscriptionCreated(tenantId: TenantId, plan: PlanTier, stripeCustomerId: string, stripeSubscriptionId: string): Promise<void>;
  onSubscriptionUpdated(tenantId: TenantId, plan: PlanTier, limits: PlanLimits): Promise<void>;
  onSubscriptionCanceled(tenantId: TenantId): Promise<void>;
  onPaymentFailed(tenantId: TenantId): Promise<void>;
  getTenantByStripeCustomerId(customerId: string): Promise<{ id: TenantId; plan: PlanTier } | null>;
}

/**
 * Stripe billing manager for hosted multi-tenant mode.
 *
 * In self-hosted (SQLite) mode this class is never instantiated.
 * All Stripe API calls are made through dynamic import to avoid
 * bundling the Stripe SDK for self-hosted deployments.
 */
export class BillingManager {
  private readonly config: BillingConfig;
  private readonly callbacks: BillingCallbacks;
  private stripe: StripeClient | null = null;

  constructor(config: BillingConfig, callbacks: BillingCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  /**
   * Lazily initialize the Stripe client.
   */
  private async getStripe(): Promise<StripeClient> {
    if (this.stripe) return this.stripe;

    const moduleName = "stripe";
    const StripeModule = (await import(/* @vite-ignore */ moduleName)) as unknown as { default: StripeConstructor };
    this.stripe = new StripeModule.default(this.config.stripeSecretKey, {
      apiVersion: "2024-12-18.acacia",
    }) as StripeClient;

    return this.stripe;
  }

  /**
   * Create a Stripe Checkout session for a new subscription.
   */
  async createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult> {
    const stripe = await this.getStripe();
    const priceId = this.config.priceIds[params.plan];

    const quantity = params.plan === "org"
      ? Math.max(params.seats ?? 10, PLAN_PRICING.org.minSeats)
      : 1;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: params.email,
      line_items: [{ price: priceId, quantity }],
      metadata: { tenantId: params.tenantId, plan: params.plan },
      success_url: params.successUrl ?? `${this.config.baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: params.cancelUrl ?? `${this.config.baseUrl}/billing/cancel`,
    });

    return {
      sessionId: session.id as string,
      url: session.url as string,
    };
  }

  /**
   * Handle a Stripe webhook event.
   * Verifies signature, dispatches to callbacks.
   */
  async handleWebhook(payload: string, signature: string): Promise<WebhookResult> {
    const stripe = await this.getStripe();

    let event: StripeEvent;
    try {
      event = stripe.webhooks.constructEvent(
        payload,
        signature,
        this.config.webhookSecret,
      ) as StripeEvent;
    } catch {
      return { handled: false };
    }

    switch (event.type) {
      case "checkout.session.completed":
        return this.handleCheckoutCompleted(event.data.object as unknown as StripeCheckoutSession);
      case "customer.subscription.updated":
        return this.handleSubscriptionUpdated(event.data.object as unknown as StripeSubscription);
      case "customer.subscription.deleted":
        return this.handleSubscriptionDeleted(event.data.object as unknown as StripeSubscription);
      case "invoice.payment_failed":
        return this.handlePaymentFailed(event.data.object as unknown as StripeInvoice);
      default:
        return { handled: false };
    }
  }

  private async handleCheckoutCompleted(session: StripeCheckoutSession): Promise<WebhookResult> {
    const tenantId = session.metadata?.tenantId as TenantId | undefined;
    const plan = session.metadata?.plan as PlanTier | undefined;

    if (!tenantId || !plan) return { handled: false };

    await this.callbacks.onSubscriptionCreated(
      tenantId,
      plan,
      session.customer as string,
      session.subscription as string,
    );

    return {
      handled: true,
      action: "subscription_created",
      tenantId,
      plan,
    };
  }

  private async handleSubscriptionUpdated(subscription: StripeSubscription): Promise<WebhookResult> {
    const customerId = subscription.customer as string;
    const tenant = await this.callbacks.getTenantByStripeCustomerId(customerId);
    if (!tenant) return { handled: false };

    // Determine the new plan from the price metadata or keep current
    const plan = tenant.plan;
    const limits = getPlanLimits(plan);

    await this.callbacks.onSubscriptionUpdated(tenant.id, plan, limits);

    return {
      handled: true,
      action: "subscription_updated",
      tenantId: tenant.id,
      plan,
    };
  }

  private async handleSubscriptionDeleted(subscription: StripeSubscription): Promise<WebhookResult> {
    const customerId = subscription.customer as string;
    const tenant = await this.callbacks.getTenantByStripeCustomerId(customerId);
    if (!tenant) return { handled: false };

    await this.callbacks.onSubscriptionCanceled(tenant.id);

    return {
      handled: true,
      action: "subscription_canceled",
      tenantId: tenant.id,
    };
  }

  private async handlePaymentFailed(invoice: StripeInvoice): Promise<WebhookResult> {
    const customerId = invoice.customer as string;
    const tenant = await this.callbacks.getTenantByStripeCustomerId(customerId);
    if (!tenant) return { handled: false };

    await this.callbacks.onPaymentFailed(tenant.id);

    return {
      handled: true,
      action: "payment_failed",
      tenantId: tenant.id,
    };
  }

  /**
   * Check if a tenant action is allowed by their plan.
   */
  checkPlanGate(
    plan: PlanTier,
    gate: "entities" | "channels" | "messages" | "sessions",
    currentCount: number,
  ): PlanGateResult {
    const limits = getPlanLimits(plan);

    const limitMap: Record<string, number> = {
      entities: limits.maxEntities,
      channels: limits.maxChannels,
      messages: limits.maxMonthlyMessages,
      sessions: limits.maxConcurrentSessions,
    };

    const limit = limitMap[gate];
    if (limit === undefined) return { allowed: true };

    if (currentCount >= limit) {
      return {
        allowed: false,
        reason: `${gate} limit reached for ${plan} plan`,
        limit,
        current: currentCount,
      };
    }

    return { allowed: true, limit, current: currentCount };
  }

  /**
   * Get the customer portal URL for managing subscriptions.
   */
  async createPortalSession(stripeCustomerId: string, returnUrl?: string): Promise<string> {
    const stripe = await this.getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl ?? `${this.config.baseUrl}/settings/billing`,
    });
    return session.url as string;
  }
}

// ---------------------------------------------------------------------------
// Minimal Stripe type stubs (avoids requiring @types/stripe at compile time)
// ---------------------------------------------------------------------------

interface StripeConstructor {
  new (key: string, config: Record<string, unknown>): StripeClient;
}

interface StripeClient {
  checkout: {
    sessions: {
      create(params: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
  };
  billingPortal: {
    sessions: {
      create(params: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
  };
  webhooks: {
    constructEvent(payload: string, signature: string, secret: string): StripeEvent;
  };
}

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

interface StripeCheckoutSession {
  id: string;
  customer: unknown;
  subscription: unknown;
  metadata?: Record<string, unknown>;
}

interface StripeSubscription {
  id: string;
  customer: unknown;
  status: string;
  items: { data: Array<{ price: { id: string; metadata?: Record<string, unknown> } }> };
}

interface StripeInvoice {
  id: string;
  customer: unknown;
  subscription: unknown;
}
