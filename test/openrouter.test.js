import test from "node:test";
import assert from "node:assert/strict";

import {
  createOpenRouterCompletion,
  extractRateLimitResetMs,
  getRetryDelayMs,
  isRetryableRequestError,
  isRetryableStatus,
} from "../src/openrouter.js";

test("isRetryableStatus recognizes rate limit and transient server errors", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
});

test("isRetryableRequestError recognizes transient fetch failures", () => {
  assert.equal(isRetryableRequestError(new Error("fetch failed")), true);
  assert.equal(isRetryableRequestError(new Error("socket hang up")), true);
  assert.equal(isRetryableRequestError(new Error("validation error")), false);
});

test("getRetryDelayMs respects rate limit reset when it is longer than exponential backoff", () => {
  const delayMs = getRetryDelayMs({
    attempt: 1,
    baseDelayMs: 1000,
    maxDelayMs: 30_000,
    nowMs: 10_000,
    rateLimitResetMs: 22_000,
  });

  assert.equal(delayMs, 12_500);
});

test("extractRateLimitResetMs falls back to metadata in the response body", () => {
  const resetMs = extractRateLimitResetMs(
    {
      headers: {
        get() {
          return null;
        },
      },
    },
    JSON.stringify({
      error: {
        metadata: {
          headers: {
            "X-RateLimit-Reset": "1774057620000",
          },
        },
      },
    }),
  );

  assert.equal(resetMs, 1774057620000);
});

test("createOpenRouterCompletion retries 429 responses with backoff", async () => {
  const recordedSleeps = [];
  let callCount = 0;

  const completion = await createOpenRouterCompletion({
    systemPrompt: "system",
    userPrompt: "user",
    model: "test/model",
    apiKey: "test-key",
    nowFn: () => 10_000,
    sleepImpl: async (ms) => {
      recordedSleeps.push(ms);
    },
    fetchImpl: async () => {
      callCount += 1;

      if (callCount === 1) {
        return mockResponse({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          headers: { "x-ratelimit-reset": "22" },
          body: JSON.stringify({ error: { message: "Rate limit exceeded" } }),
        });
      }

      return mockResponse({
        ok: true,
        status: 200,
        statusText: "OK",
        jsonBody: {
          model: "test/model",
          choices: [{ message: { content: "{\"semantic_similarity\":90,\"information_amount_parity\":90,\"doc_a_coverage_by_doc_b\":90,\"doc_b_coverage_by_doc_a\":90,\"verdict\":\"pending_calibration\",\"summary\":\"ok\",\"shared_points\":[],\"doc_a_only_points\":[],\"doc_b_only_points\":[],\"information_gap_notes\":[],\"confidence\":\"high\"}" } }],
        },
      });
    },
  });

  assert.equal(callCount, 2);
  assert.deepEqual(recordedSleeps, [12_500]);
  assert.equal(completion.model, "test/model");
});

function mockResponse({
  ok,
  status,
  statusText,
  headers = {},
  body = "",
  jsonBody,
}) {
  return {
    ok,
    status,
    statusText,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? headers[name] ?? null;
      },
    },
    async text() {
      return body;
    },
    async json() {
      return jsonBody;
    },
  };
}
