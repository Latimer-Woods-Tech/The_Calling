// ============================================================================
// Stripe Webhook Handler
// ============================================================================
// Processes Stripe payment events: payment succeeded, payment failed,
// refund created, etc.
// ============================================================================

import { VoiceGamePlatform } from '../core/platform.js';
import { StripeClient } from '../integrations/stripe.js';

export class StripeWebhookHandler {
  private platform: VoiceGamePlatform;
  private stripe: StripeClient;
  private webhookSecret: string;

  constructor(platform: VoiceGamePlatform, stripe: StripeClient, webhookSecret: string) {
    this.platform = platform;
    this.stripe = stripe;
    this.webhookSecret = webhookSecret;
  }

  /**
   * Handle a Stripe webhook event
   */
  async handleEvent(rawBody: string, signature: string): Promise<Response> {
    // Verify webhook signature
    const isValid = await this.stripe.verifyWebhookSignature(rawBody, signature, this.webhookSecret);
    if (!isValid) {
      console.error('[Stripe Webhook] Invalid signature');
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const event = JSON.parse(rawBody);
    console.log(`[Stripe Webhook] Event: ${event.type}`);

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          return this.onPaymentSucceeded(event);

        case 'payment_intent.payment_failed':
          return this.onPaymentFailed(event);

        case 'charge.refunded':
          return this.onRefund(event);

        default:
          return this.ok();
      }
    } catch (error) {
      console.error(`[Stripe Webhook] Error handling ${event.type}:`, error);
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Payment succeeded — mark participant as paid
   */
  private async onPaymentSucceeded(event: any): Promise<Response> {
    const paymentIntent = event.data.object;
    const participantId = paymentIntent.metadata?.participant_id;
    const gameInstanceId = paymentIntent.metadata?.game_instance_id;

    if (!participantId) {
      console.error('[Stripe Webhook] Missing participant_id in metadata');
      return this.ok(); // Acknowledge to avoid retries
    }

    await this.platform.handlePaymentConfirmed(participantId, paymentIntent.id);

    console.log(`[Stripe Webhook] Payment confirmed for participant ${participantId} in game ${gameInstanceId}`);
    return this.ok();
  }

  /**
   * Payment failed
   */
  private async onPaymentFailed(event: any): Promise<Response> {
    const paymentIntent = event.data.object;
    const participantId = paymentIntent.metadata?.participant_id;

    console.warn(`[Stripe Webhook] Payment failed for participant ${participantId}: ${paymentIntent.last_payment_error?.message}`);

    // Could notify the player or update participant status
    return this.ok();
  }

  /**
   * Refund processed
   */
  private async onRefund(event: any): Promise<Response> {
    const charge = event.data.object;
    console.log(`[Stripe Webhook] Refund processed: ${charge.id}`);
    return this.ok();
  }

  private ok(): Response {
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
