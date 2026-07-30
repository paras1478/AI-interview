// Render's free tier spins the backend down when idle, so the first request
// after a period of inactivity can fail with a 502/network error while it
// cold-starts. Retry a few times with backoff before giving up.
export async function withRetry<T>(
    fn: () => Promise<T>,
    { retries = 4, delayMs = 3000 }: { retries?: number; delayMs?: number } = {},
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt === retries) break;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    throw lastError;
}
