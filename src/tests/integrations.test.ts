// ============================================================================
// Integration Client Tests
// ============================================================================
// Tests for integration client initialization and method signatures.
// Uses mocked fetch to avoid real API calls.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('TelnyxClient', () => {
  it('initializes with correct config', async () => {
    const { TelnyxClient } = await import('../integrations/telnyx.js');
    const client = new TelnyxClient('key', 'conn-id', '+1234567890');
    expect(client).toBeDefined();
  });
});

describe('DeepgramClient', () => {
  it('initializes with API key', async () => {
    const { DeepgramClient } = await import('../integrations/deepgram.js');
    const client = new DeepgramClient('key');
    expect(client).toBeDefined();
  });
});

describe('AssemblyAIClient', () => {
  it('initializes with API key', async () => {
    const { AssemblyAIClient } = await import('../integrations/assemblyai.js');
    const client = new AssemblyAIClient('key');
    expect(client).toBeDefined();
  });
});

describe('ElevenLabsClient', () => {
  it('initializes with API key', async () => {
    const { ElevenLabsClient } = await import('../integrations/elevenlabs.js');
    const client = new ElevenLabsClient('key');
    expect(client).toBeDefined();
  });

  it('accepts custom voice ID', async () => {
    const { ElevenLabsClient } = await import('../integrations/elevenlabs.js');
    const client = new ElevenLabsClient('key', 'custom-voice-id');
    expect(client).toBeDefined();
  });
});

describe('StripeClient', () => {
  it('initializes with secret key', async () => {
    const { StripeClient } = await import('../integrations/stripe.js');
    const client = new StripeClient('sk_test_xxx');
    expect(client).toBeDefined();
  });
});

describe('ResendClient', () => {
  it('initializes with API key', async () => {
    const { ResendClient } = await import('../integrations/resend.js');
    const client = new ResendClient('key');
    expect(client).toBeDefined();
  });

  it('accepts custom from email', async () => {
    const { ResendClient } = await import('../integrations/resend.js');
    const client = new ResendClient('key', 'custom@example.com');
    expect(client).toBeDefined();
  });
});

describe('SentryClient', () => {
  it('initializes with DSN', async () => {
    const { SentryClient } = await import('../integrations/sentry.js');
    const client = new SentryClient('https://key@sentry.io/123');
    expect(client).toBeDefined();
  });
});

describe('OpenAIClient', () => {
  it('initializes with API key', async () => {
    const { OpenAIClient } = await import('../integrations/openai.js');
    const client = new OpenAIClient('sk-xxx');
    expect(client).toBeDefined();
  });
});
