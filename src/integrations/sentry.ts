// ============================================================================
// Sentry Integration - Error Tracking & Monitoring
// ============================================================================

export class SentryClient {
  private dsn: string;
  private environment: string;

  constructor(dsn: string, environment: string = 'production') {
    this.dsn = dsn;
    this.environment = environment;
  }

  /**
   * Parse DSN into components for the envelope API
   */
  private parseDsn(): { publicKey: string; host: string; projectId: string } {
    const url = new URL(this.dsn);
    return {
      publicKey: url.username,
      host: `${url.protocol}//${url.host}`,
      projectId: url.pathname.replace('/', ''),
    };
  }

  /**
   * Capture an exception and send to Sentry via envelope API
   * (Cloudflare Workers compatible — no Node.js SDK needed)
   */
  async captureException(error: Error, context?: Record<string, any>): Promise<string> {
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const { publicKey, host, projectId } = this.parseDsn();

    const envelope = this.buildEnvelope(eventId, {
      exception: {
        values: [{
          type: error.name,
          value: error.message,
          stacktrace: error.stack ? { frames: this.parseStack(error.stack) } : undefined,
        }],
      },
      level: 'error',
      environment: this.environment,
      extra: context,
      timestamp: Date.now() / 1000,
    });

    try {
      await fetch(`${host}/api/${projectId}/envelope/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7,sentry_client=thecalling/1.0,sentry_key=${publicKey}`,
        },
        body: envelope,
      });
    } catch {
      // Silently fail — don't let monitoring break the game
    }

    return eventId;
  }

  /**
   * Capture a message
   */
  async captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info', context?: Record<string, any>): Promise<string> {
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const { publicKey, host, projectId } = this.parseDsn();

    const envelope = this.buildEnvelope(eventId, {
      message: { formatted: message },
      level,
      environment: this.environment,
      extra: context,
      timestamp: Date.now() / 1000,
    });

    try {
      await fetch(`${host}/api/${projectId}/envelope/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7,sentry_client=thecalling/1.0,sentry_key=${publicKey}`,
        },
        body: envelope,
      });
    } catch {
      // Silently fail
    }

    return eventId;
  }

  private buildEnvelope(eventId: string, event: Record<string, any>): string {
    const { publicKey } = this.parseDsn();
    const header = JSON.stringify({
      event_id: eventId,
      sent_at: new Date().toISOString(),
      dsn: this.dsn,
    });
    const itemHeader = JSON.stringify({
      type: 'event',
      content_type: 'application/json',
    });
    const itemPayload = JSON.stringify({
      event_id: eventId,
      ...event,
    });

    return `${header}\n${itemHeader}\n${itemPayload}`;
  }

  private parseStack(stack: string): { filename: string; function: string; lineno: number }[] {
    return stack.split('\n').slice(1).map(line => {
      const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):\d+\)/);
      return {
        function: match?.[1] ?? '<anonymous>',
        filename: match?.[2] ?? '<unknown>',
        lineno: parseInt(match?.[3] ?? '0', 10),
      };
    }).filter(f => f.lineno > 0);
  }
}
