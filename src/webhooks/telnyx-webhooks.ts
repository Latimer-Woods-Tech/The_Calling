// ============================================================================
// Telnyx Webhook Handler
// ============================================================================
// Processes Telnyx voice event webhooks: call answered, recording complete,
// DTMF input, call hangup, etc.
// ============================================================================

import type { Env, TelnyxWebhookPayload } from '../types/index.js';
import { VoiceGamePlatform } from '../core/platform.js';
import { GameStateManager } from '../state/game-state.js';

export class TelnyxWebhookHandler {
  private platform: VoiceGamePlatform;
  private state: GameStateManager;

  constructor(platform: VoiceGamePlatform, state: GameStateManager) {
    this.platform = platform;
    this.state = state;
  }

  /**
   * Route a Telnyx webhook event to the appropriate handler
   */
  async handleEvent(gameId: string, payload: TelnyxWebhookPayload): Promise<Response> {
    const eventType = payload.data?.event_type;
    const callControlId = payload.data?.payload?.call_control_id;

    console.log(`[Telnyx Webhook] Game: ${gameId}, Event: ${eventType}`);

    try {
      switch (eventType) {
        case 'call.initiated':
          return this.onCallInitiated(gameId, payload);

        case 'call.answered':
          return this.onCallAnswered(gameId, payload);

        case 'call.hangup':
          return this.onCallHangup(gameId, payload);

        case 'call.recording.saved':
          return this.onRecordingSaved(gameId, payload);

        case 'call.speak.ended':
          return this.onSpeakEnded(gameId, payload);

        case 'call.playback.ended':
          return this.onPlaybackEnded(gameId, payload);

        case 'call.dtmf.received':
          return this.onDtmfReceived(gameId, payload);

        default:
          console.log(`[Telnyx Webhook] Unhandled event: ${eventType}`);
          return new Response(JSON.stringify({ status: 'ok', handled: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
      }
    } catch (error) {
      console.error(`[Telnyx Webhook] Error handling ${eventType}:`, error);
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Call has been initiated (ringing)
   */
  private async onCallInitiated(gameId: string, payload: TelnyxWebhookPayload): Promise<Response> {
    // No action needed — wait for answer
    return this.ok();
  }

  /**
   * Player answered the phone
   */
  private async onCallAnswered(gameId: string, payload: TelnyxWebhookPayload): Promise<Response> {
    const callControlId = payload.data?.payload?.call_control_id;
    const clientState = payload.data?.payload?.client_state;

    if (clientState) {
      try {
        const decoded = JSON.parse(atob(clientState));
        const playerId = decoded.playerId;

        // Update call mapping in Redis
        if (callControlId && playerId) {
          await this.state.setPlayerCall(gameId, playerId, callControlId);
        }
      } catch {
        // Client state decode failed
      }
    }

    // Welcome the player with a greeting
    if (callControlId) {
      // Use Telnyx API to speak welcome
      // The platform will handle the actual game flow
    }

    return this.ok();
  }

  /**
   * Player hung up or call disconnected
   */
  private async onCallHangup(gameId: string, payload: TelnyxWebhookPayload): Promise<Response> {
    const clientState = payload.data?.payload?.client_state;

    if (clientState) {
      try {
        const decoded = JSON.parse(atob(clientState));
        const playerId = decoded.playerId;

        if (playerId) {
          // Remove player from alive set (they disconnected)
          await this.state.removeAlivePlayer(gameId, playerId);
        }
      } catch {
        // Client state decode failed
      }
    }

    return this.ok();
  }

  /**
   * Recording has been saved — contains player's voice answer
   */
  private async onRecordingSaved(gameId: string, payload: TelnyxWebhookPayload): Promise<Response> {
    const recordingUrl = payload.data?.payload?.recording_urls?.mp3;
    const clientState = payload.data?.payload?.client_state;

    if (!recordingUrl || !clientState) return this.ok();

    try {
      const decoded = JSON.parse(atob(clientState));
      const playerId = decoded.playerId;

      if (playerId) {
        // Get current turn number from Redis
        const turnIndex = await this.state.getCurrentQuestionIndex(gameId);

        // Process the voice answer (STT + submit to Redis)
        await this.platform.processVoiceAnswer(
          gameId,
          playerId,
          recordingUrl,
          turnIndex
        );
      }
    } catch (error) {
      console.error('[Telnyx Webhook] Error processing recording:', error);
    }

    return this.ok();
  }

  /**
   * TTS speech has finished playing
   */
  private async onSpeakEnded(gameId: string, payload: TelnyxWebhookPayload): Promise<Response> {
    // Could trigger recording start or next action
    return this.ok();
  }

  /**
   * Audio playback has finished
   */
  private async onPlaybackEnded(gameId: string, payload: TelnyxWebhookPayload): Promise<Response> {
    return this.ok();
  }

  /**
   * DTMF tone received (player pressed a key)
   * Could be used as alternative to voice (press 1 for A, 2 for B, etc.)
   */
  private async onDtmfReceived(gameId: string, payload: TelnyxWebhookPayload): Promise<Response> {
    const digit = payload.data?.payload?.digit;
    const clientState = payload.data?.payload?.client_state;

    if (!digit || !clientState) return this.ok();

    try {
      const decoded = JSON.parse(atob(clientState));
      const playerId = decoded.playerId;

      if (playerId) {
        const dtmfToAnswer: Record<string, string> = {
          '1': 'A', '2': 'B', '3': 'C', '4': 'D',
        };
        const answer = dtmfToAnswer[digit];
        if (answer) {
          const turnIndex = await this.state.getCurrentQuestionIndex(gameId);
          await this.state.submitAnswer(gameId, turnIndex, playerId, {
            answer,
            confidence: 1.0, // DTMF is definitive
            timestamp: Date.now(),
            inputMethod: 'dtmf',
          });
        }
      }
    } catch (error) {
      console.error('[Telnyx Webhook] Error processing DTMF:', error);
    }

    return this.ok();
  }

  private ok(): Response {
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
