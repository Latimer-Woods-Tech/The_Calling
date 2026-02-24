// ============================================================================
// Resend Integration - Email Notifications
// ============================================================================

export class ResendClient {
  private apiKey: string;
  private fromEmail: string;
  private baseUrl = 'https://api.resend.com';

  constructor(apiKey: string, fromEmail: string = 'game@thecalling.io') {
    this.apiKey = apiKey;
    this.fromEmail = fromEmail;
  }

  /**
   * Send an email notification
   */
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string
  ): Promise<{ id: string }> {
    const response = await fetch(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.fromEmail,
        to: [to],
        subject,
        html,
        text: text ?? subject,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Resend API error (${response.status}): ${error}`);
    }

    return response.json() as Promise<{ id: string }>;
  }

  /**
   * Send game registration confirmation
   */
  async sendRegistrationConfirmation(
    email: string,
    playerName: string,
    gameName: string,
    scheduledAt: string,
    entryFee: number
  ): Promise<void> {
    await this.sendEmail(
      email,
      `You're registered for ${gameName}!`,
      `
        <h2>Welcome to The Calling!</h2>
        <p>Hi ${playerName},</p>
        <p>You're registered for <strong>${gameName}</strong>.</p>
        <ul>
          <li><strong>When:</strong> ${new Date(scheduledAt).toLocaleString()}</li>
          <li><strong>Entry Fee:</strong> $${entryFee.toFixed(2)}</li>
        </ul>
        <p>We'll call you at game time. Make sure your phone is on!</p>
        <p>— The Calling Team</p>
      `
    );
  }

  /**
   * Send winner notification
   */
  async sendWinnerNotification(
    email: string,
    playerName: string,
    gameName: string,
    prizeAmount: number,
    placement: number
  ): Promise<void> {
    await this.sendEmail(
      email,
      `Congratulations! You won ${gameName}!`,
      `
        <h2>🏆 You Won!</h2>
        <p>Hi ${playerName},</p>
        <p>Congratulations on finishing <strong>#${placement}</strong> in <strong>${gameName}</strong>!</p>
        <p>Your prize of <strong>$${prizeAmount.toFixed(2)}</strong> is being transferred to your account.</p>
        <p>— The Calling Team</p>
      `
    );
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/domains`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return response.ok || response.status === 401;
    } catch {
      return false;
    }
  }
}
