// ============================================================================
// Deepgram Integration - Speech-to-Text
// ============================================================================

export interface TranscriptionResult {
  transcript: string;
  confidence: number;
  words: { word: string; start: number; end: number; confidence: number }[];
  duration: number;
}

export class DeepgramClient {
  private apiKey: string;
  private baseUrl = 'https://api.deepgram.com/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Transcribe audio from a URL (e.g., Telnyx recording URL)
   */
  async transcribeUrl(audioUrl: string): Promise<TranscriptionResult> {
    const response = await fetch(`${this.baseUrl}/listen?model=nova-2&smart_format=true&language=en`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: audioUrl }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Deepgram API error (${response.status}): ${error}`);
    }

    const data: any = await response.json();
    const result = data.results?.channels?.[0]?.alternatives?.[0];

    return {
      transcript: result?.transcript ?? '',
      confidence: result?.confidence ?? 0,
      words: result?.words ?? [],
      duration: data.metadata?.duration ?? 0,
    };
  }

  /**
   * Transcribe raw audio buffer
   */
  async transcribeBuffer(audioBuffer: ArrayBuffer, mimetype: string = 'audio/mp3'): Promise<TranscriptionResult> {
    const response = await fetch(`${this.baseUrl}/listen?model=nova-2&smart_format=true&language=en`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': mimetype,
      },
      body: audioBuffer,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Deepgram API error (${response.status}): ${error}`);
    }

    const data: any = await response.json();
    const result = data.results?.channels?.[0]?.alternatives?.[0];

    return {
      transcript: result?.transcript ?? '',
      confidence: result?.confidence ?? 0,
      words: result?.words ?? [],
      duration: data.metadata?.duration ?? 0,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/listen`, {
        method: 'OPTIONS',
        headers: { 'Authorization': `Token ${this.apiKey}` },
      });
      return response.ok || response.status === 405;
    } catch {
      return false;
    }
  }
}
