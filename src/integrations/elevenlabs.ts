// ============================================================================
// ElevenLabs Integration - Text-to-Speech
// ============================================================================

export class ElevenLabsClient {
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';
  private defaultVoiceId: string;

  constructor(apiKey: string, defaultVoiceId: string = '21m00Tcm4TlvDq8ikWAM') {
    // Default voice: Rachel (clear, professional female voice)
    this.apiKey = apiKey;
    this.defaultVoiceId = defaultVoiceId;
  }

  /**
   * Generate speech audio from text.
   * Returns audio as ArrayBuffer (mp3 format).
   */
  async generateSpeech(
    text: string,
    voiceId?: string,
    options?: {
      stability?: number;
      similarity_boost?: number;
      style?: number;
      speed?: number;
    }
  ): Promise<ArrayBuffer> {
    const voice = voiceId ?? this.defaultVoiceId;

    const response = await fetch(`${this.baseUrl}/text-to-speech/${voice}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: options?.stability ?? 0.5,
          similarity_boost: options?.similarity_boost ?? 0.75,
          style: options?.style ?? 0.0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs API error (${response.status}): ${error}`);
    }

    return response.arrayBuffer();
  }

  /**
   * Get available voices
   */
  async listVoices(): Promise<{ voice_id: string; name: string; category: string }[]> {
    const response = await fetch(`${this.baseUrl}/voices`, {
      headers: { 'xi-api-key': this.apiKey },
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs voices error: ${response.statusText}`);
    }

    const data = await response.json() as { voices: any[] };
    return data.voices.map((v: any) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
    }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/voices`, {
        headers: { 'xi-api-key': this.apiKey },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
