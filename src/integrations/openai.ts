// ============================================================================
// OpenAI Integration - AI Question Validation & Response Analysis
// ============================================================================

export class OpenAIClient {
  private apiKey: string;
  private baseUrl = 'https://api.openai.com/v1';
  private defaultModel = 'gpt-4o-mini';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Send a chat completion request
   */
  async chatCompletion(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      responseFormat?: 'text' | 'json_object';
    }
  ): Promise<string> {
    const body: Record<string, any> = {
      model: options?.model ?? this.defaultModel,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 500,
    };

    if (options?.responseFormat === 'json_object') {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${error}`);
    }

    const data = await response.json() as any;
    return data.choices[0].message.content;
  }

  /**
   * Validate whether a spoken answer matches the correct answer.
   * Accounts for speech-to-text transcription errors, synonyms, partial matches.
   */
  async validateSpokenAnswer(
    question: string,
    correctAnswer: string,
    spokenAnswer: string,
    options: string[]
  ): Promise<{
    isCorrect: boolean;
    confidence: number;
    matchedOption: string | null;
    reasoning: string;
  }> {
    const result = await this.chatCompletion(
      [
        {
          role: 'system',
          content: `You are a game answer validator. A player spoke their answer aloud and it was transcribed by speech-to-text.
Your job is to determine if the transcribed answer matches the correct answer, accounting for:
- STT transcription errors (homophones, garbled words)
- Partial answers, synonyms, or alternative phrasings
- The player saying the letter (A, B, C, D) or the full answer text

Respond in JSON format: { "isCorrect": boolean, "confidence": number (0-1), "matchedOption": string | null, "reasoning": string }`
        },
        {
          role: 'user',
          content: `Question: ${question}
Options: ${options.join(', ')}
Correct answer: ${correctAnswer}
Player said: "${spokenAnswer}"

Is this correct?`
        }
      ],
      { responseFormat: 'json_object', temperature: 0.1 }
    );

    try {
      return JSON.parse(result);
    } catch {
      return {
        isCorrect: false,
        confidence: 0,
        matchedOption: null,
        reasoning: 'Failed to parse validation result',
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
