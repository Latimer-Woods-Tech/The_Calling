// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a random string of specified length
 */
export function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    result += chars[byte % chars.length];
  }
  return result;
}

/**
 * Format a phone number to E.164 format
 */
export function formatPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.startsWith('+')) return phone;
  return `+${digits}`;
}

/**
 * Calculate prize pool distribution
 * Default: 85% to players, 15% platform fee
 */
export function calculatePrizeDistribution(
  entryFee: number,
  playerCount: number,
  platformFeePercent: number = 15,
  winnerDistribution: number[] = [1.0] // Default: 100% to winner
): { prizePool: number; platformFee: number; winnerPrizes: number[] } {
  const totalRevenue = entryFee * playerCount;
  const platformFee = totalRevenue * (platformFeePercent / 100);
  const prizePool = totalRevenue - platformFee;

  const winnerPrizes = winnerDistribution.map(pct => prizePool * pct);

  return { prizePool, platformFee, winnerPrizes };
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, i) + Math.random() * 500;
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/**
 * Safely parse JSON with a fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Truncate text to max length with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
