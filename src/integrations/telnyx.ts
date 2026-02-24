// ============================================================================
// Telnyx Integration - Voice Call Orchestration
// ============================================================================

import type { ActiveCall } from '../types/index.js';

export class TelnyxClient {
  private apiKey: string;
  private connectionId: string;
  private phoneNumber: string;
  private baseUrl = 'https://api.telnyx.com/v2';

  constructor(apiKey: string, connectionId: string, phoneNumber: string) {
    this.apiKey = apiKey;
    this.connectionId = connectionId;
    this.phoneNumber = phoneNumber;
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telnyx API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  /**
   * Initiate an outbound call to a player
   */
  async createCall(to: string, webhookUrl: string, clientState?: string): Promise<{ callControlId: string; callLegId: string }> {
    const result = await this.request('POST', '/calls', {
      to,
      from: this.phoneNumber,
      connection_id: this.connectionId,
      webhook_url: webhookUrl,
      webhook_url_method: 'POST',
      client_state: clientState ? Buffer.from(clientState).toString('base64') : undefined,
    });

    return {
      callControlId: result.data.call_control_id,
      callLegId: result.data.call_leg_id,
    };
  }

  /**
   * Speak text to a call using Telnyx TTS
   */
  async speak(callControlId: string, text: string, voice: string = 'female'): Promise<void> {
    await this.request('POST', `/calls/${callControlId}/actions/speak`, {
      payload: text,
      voice,
      language: 'en-US',
    });
  }

  /**
   * Play audio file to a call
   */
  async playAudio(callControlId: string, audioUrl: string): Promise<void> {
    await this.request('POST', `/calls/${callControlId}/actions/playback_start`, {
      audio_url: audioUrl,
    });
  }

  /**
   * Start recording a call
   */
  async startRecording(callControlId: string): Promise<void> {
    await this.request('POST', `/calls/${callControlId}/actions/record_start`, {
      channels: 'single',
      format: 'mp3',
    });
  }

  /**
   * Stop recording a call
   */
  async stopRecording(callControlId: string): Promise<void> {
    await this.request('POST', `/calls/${callControlId}/actions/record_stop`);
  }

  /**
   * Hang up a call
   */
  async hangup(callControlId: string): Promise<void> {
    await this.request('POST', `/calls/${callControlId}/actions/hangup`);
  }

  /**
   * Answer an incoming call
   */
  async answer(callControlId: string): Promise<void> {
    await this.request('POST', `/calls/${callControlId}/actions/answer`);
  }

  /**
   * Initiate calls to all players in a game.
   * Returns array of active calls. Handles individual call failures gracefully.
   */
  async callAllPlayers(
    players: { id: string; phoneNumber: string }[],
    gameId: string,
    webhookBaseUrl: string
  ): Promise<{ successful: ActiveCall[]; failed: { playerId: string; error: string }[] }> {
    const webhookUrl = `${webhookBaseUrl}/webhooks/telnyx/${gameId}`;
    const successful: ActiveCall[] = [];
    const failed: { playerId: string; error: string }[] = [];

    // Batch calls in groups of 20 with 500ms delay between batches
    const batchSize = 20;
    for (let i = 0; i < players.length; i += batchSize) {
      const batch = players.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(async (player) => {
          const clientState = JSON.stringify({ playerId: player.id, gameId });
          const result = await this.createCall(player.phoneNumber, webhookUrl, clientState);
          return {
            callControlId: result.callControlId,
            playerId: player.id,
            gameId,
            status: 'ringing' as const,
          };
        })
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled') {
          successful.push(result.value);
        } else {
          failed.push({
            playerId: batch[j].id,
            error: result.reason?.message ?? 'Unknown error',
          });
        }
      }

      // Stagger batches to avoid rate limiting
      if (i + batchSize < players.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return { successful, failed };
  }

  /**
   * Speak text to multiple calls simultaneously
   */
  async speakToAll(callControlIds: string[], text: string, voice: string = 'female'): Promise<void> {
    await Promise.allSettled(
      callControlIds.map(id => this.speak(id, text, voice))
    );
  }

  /**
   * Start recording on multiple calls simultaneously
   */
  async startRecordingAll(callControlIds: string[]): Promise<void> {
    await Promise.allSettled(
      callControlIds.map(id => this.startRecording(id))
    );
  }

  /**
   * Stop recording on multiple calls simultaneously
   */
  async stopRecordingAll(callControlIds: string[]): Promise<void> {
    await Promise.allSettled(
      callControlIds.map(id => this.stopRecording(id))
    );
  }

  /**
   * Hang up multiple calls
   */
  async hangupAll(callControlIds: string[]): Promise<void> {
    await Promise.allSettled(
      callControlIds.map(id => this.hangup(id))
    );
  }
}
