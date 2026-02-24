// ============================================================================
// AssemblyAI Integration - Fallback Speech-to-Text
// ============================================================================

import type { TranscriptionResult } from './deepgram.js';

export class AssemblyAIClient {
  private apiKey: string;
  private baseUrl = 'https://api.assemblyai.com/v2';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Transcribe audio from a URL.
   * AssemblyAI uses an async model: submit → poll → get result.
   * For short game audio (<30s), we poll with short intervals.
   */
  async transcribeUrl(audioUrl: string, maxWaitMs: number = 30000): Promise<TranscriptionResult> {
    // Step 1: Submit transcription request
    const submitResponse = await fetch(`${this.baseUrl}/transcript`, {
      method: 'POST',
      headers: {
        'Authorization': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        language_code: 'en',
      }),
    });

    if (!submitResponse.ok) {
      const error = await submitResponse.text();
      throw new Error(`AssemblyAI submit error (${submitResponse.status}): ${error}`);
    }

    const { id } = await submitResponse.json() as { id: string };

    // Step 2: Poll for completion
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const pollResponse = await fetch(`${this.baseUrl}/transcript/${id}`, {
        headers: { 'Authorization': this.apiKey },
      });

      if (!pollResponse.ok) continue;

      const result = await pollResponse.json() as any;

      if (result.status === 'completed') {
        return {
          transcript: result.text ?? '',
          confidence: result.confidence ?? 0,
          words: (result.words ?? []).map((w: any) => ({
            word: w.text,
            start: w.start / 1000,
            end: w.end / 1000,
            confidence: w.confidence,
          })),
          duration: result.audio_duration ?? 0,
        };
      }

      if (result.status === 'error') {
        throw new Error(`AssemblyAI transcription failed: ${result.error}`);
      }
    }

    throw new Error('AssemblyAI transcription timed out');
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/transcript`, {
        method: 'OPTIONS',
        headers: { 'Authorization': this.apiKey },
      });
      return response.ok || response.status === 405 || response.status === 401;
    } catch {
      return false;
    }
  }
}
