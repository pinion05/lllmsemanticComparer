import { requireEnvValue } from "./env.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_BASE_DELAY_MS = 1_500;
const DEFAULT_MAX_DELAY_MS = 30_000;
const RATE_LIMIT_BUFFER_MS = 500;

export async function createOpenRouterCompletion({
  systemPrompt,
  userPrompt,
  model = process.env.OPENROUTER_DEFAULT_MODEL,
  apiKey = process.env.OPENROUTER_API_KEY,
  fetchImpl = globalThis.fetch,
  referer = "https://local.cli/doc-similarity",
  title = "doc-similarity-evaluator",
  maxRetries = DEFAULT_MAX_RETRIES,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  sleepImpl = sleep,
  nowFn = Date.now,
}) {
  const resolvedApiKey = apiKey || (await requireEnvValue("OPENROUTER_API_KEY"));
  const resolvedModel = model || (await requireEnvValue("OPENROUTER_DEFAULT_MODEL"));

  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchImpl(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resolvedApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": referer,
          "X-Title": title,
        },
        body: JSON.stringify({
          model: resolvedModel,
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (response.ok) {
        return response.json();
      }

      const errorBody = await safeReadText(response);
      const retryable = isRetryableStatus(response.status);

      if (retryable && attempt < maxRetries) {
        const delayMs = getRetryDelayMs({
          attempt,
          baseDelayMs,
          maxDelayMs,
          nowMs: nowFn(),
          rateLimitResetMs: extractRateLimitResetMs(response, errorBody),
        });

        await sleepImpl(delayMs);
        continue;
      }

      throw new Error(
        `OpenRouter request failed with ${response.status} ${response.statusText}: ${errorBody}`,
      );
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableRequestError(error)) {
        throw error;
      }

      const delayMs = getRetryDelayMs({
        attempt,
        baseDelayMs,
        maxDelayMs,
        nowMs: nowFn(),
      });

      await sleepImpl(delayMs);
    }
  }

  throw new Error("OpenRouter request exhausted retries without returning a response.");
}

export function isRetryableStatus(status) {
  return RETRYABLE_STATUS_CODES.has(status);
}

export function isRetryableRequestError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return [
    "network",
    "fetch failed",
    "timed out",
    "timeout",
    "econnreset",
    "enotfound",
    "eai_again",
    "socket hang up",
  ].some((fragment) => message.includes(fragment));
}

export function getRetryDelayMs({
  attempt,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  nowMs = Date.now(),
  rateLimitResetMs,
}) {
  const exponentialDelayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));

  if (typeof rateLimitResetMs === "number" && Number.isFinite(rateLimitResetMs)) {
    const untilResetMs = Math.max(0, rateLimitResetMs - nowMs + RATE_LIMIT_BUFFER_MS);
    return Math.max(exponentialDelayMs, Math.min(maxDelayMs, untilResetMs));
  }

  return exponentialDelayMs;
}

export function extractRateLimitResetMs(response, errorBody) {
  const headerValue = response?.headers?.get?.("x-ratelimit-reset");
  const parsedHeaderValue = parseResetTimestamp(headerValue);

  if (parsedHeaderValue) {
    return parsedHeaderValue;
  }

  try {
    const parsedBody = JSON.parse(errorBody);
    return parseResetTimestamp(parsedBody?.error?.metadata?.headers?.["X-RateLimit-Reset"]);
  } catch {
    return null;
  }
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return "<unable to read response body>";
  }
}

function parseResetTimestamp(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return numericValue < 1e12 ? numericValue * 1000 : numericValue;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
