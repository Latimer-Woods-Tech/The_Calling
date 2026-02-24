// ============================================================================
// Stripe Integration - Payments & Payouts
// ============================================================================

export class StripeClient {
  private secretKey: string;
  private baseUrl = 'https://api.stripe.com/v1';

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  private async request(method: string, path: string, body?: Record<string, any>): Promise<any> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.secretKey}`,
    };

    let requestBody: string | undefined;
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      requestBody = new URLSearchParams(
        Object.entries(body).reduce((acc, [key, value]) => {
          if (value !== undefined && value !== null) {
            acc[key] = String(value);
          }
          return acc;
        }, {} as Record<string, string>)
      ).toString();
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: requestBody,
    });

    if (!response.ok) {
      const error = await response.json() as any;
      throw new Error(`Stripe API error: ${error.error?.message ?? response.statusText}`);
    }

    return response.json();
  }

  /**
   * Create a Payment Intent for game entry fee
   */
  async createPaymentIntent(
    amount: number, // in dollars
    metadata: { gameInstanceId: string; playerId: string; participantId: string }
  ): Promise<{ id: string; clientSecret: string; status: string }> {
    const result = await this.request('POST', '/payment_intents', {
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      'metadata[game_instance_id]': metadata.gameInstanceId,
      'metadata[player_id]': metadata.playerId,
      'metadata[participant_id]': metadata.participantId,
    });

    return {
      id: result.id,
      clientSecret: result.client_secret,
      status: result.status,
    };
  }

  /**
   * Confirm a Payment Intent
   */
  async confirmPaymentIntent(paymentIntentId: string): Promise<{ status: string }> {
    const result = await this.request('POST', `/payment_intents/${paymentIntentId}/confirm`);
    return { status: result.status };
  }

  /**
   * Retrieve a Payment Intent
   */
  async getPaymentIntent(paymentIntentId: string): Promise<any> {
    return this.request('GET', `/payment_intents/${paymentIntentId}`);
  }

  /**
   * Create a transfer (payout) to a connected account
   */
  async createTransfer(
    amount: number, // in dollars
    destinationAccountId: string,
    description: string,
    metadata?: Record<string, string>
  ): Promise<{ id: string; amount: number; status: string }> {
    const body: Record<string, any> = {
      amount: Math.round(amount * 100),
      currency: 'usd',
      destination: destinationAccountId,
      description,
    };

    if (metadata) {
      Object.entries(metadata).forEach(([key, value]) => {
        body[`metadata[${key}]`] = value;
      });
    }

    const result = await this.request('POST', '/transfers', body);

    return {
      id: result.id,
      amount: result.amount / 100,
      status: result.status ?? 'pending',
    };
  }

  /**
   * Verify a Stripe webhook signature
   */
  async verifyWebhookSignature(
    payload: string,
    signature: string,
    webhookSecret: string
  ): Promise<boolean> {
    // Stripe webhook signature verification
    // Format: t=timestamp,v1=signature
    const parts = signature.split(',');
    const timestamp = parts.find(p => p.startsWith('t='))?.substring(2);
    const v1Sig = parts.find(p => p.startsWith('v1='))?.substring(3);

    if (!timestamp || !v1Sig) return false;

    // Check timestamp is within 5 minutes
    const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
    if (age > 300) return false;

    // Compute expected signature
    const signedPayload = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
    const expectedSig = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return expectedSig === v1Sig;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.request('GET', '/balance');
      return !!result.object;
    } catch {
      return false;
    }
  }
}
