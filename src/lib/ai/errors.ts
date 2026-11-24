const failures = {
  gemini_missing_credentials: [
    503,
    "Gemini credentials are unavailable. Configure GEMINI_API_KEY on the server.",
  ],
  gemini_authentication_failed: [
    502,
    "Gemini rejected the server credentials.",
  ],
  gemini_rate_limited: [429, "Gemini has reached its request or usage limit."],
  gemini_unavailable: [503, "Gemini could not complete the request."],
  gemini_timeout: [504, "Gemini did not respond in time."],
  gemini_cancelled: [408, "The generation request was cancelled."],
  gemini_token_limit: [
    502,
    "Gemini stopped before completing the structured response.",
  ],
  gemini_blocked: [
    502,
    "Gemini could not return generated content for this request.",
  ],
  gemini_empty_response: [502, "Gemini returned no generated text."],
  gemini_invalid_json: [502, "Gemini returned invalid JSON."],
  gemini_invalid_response: [502, "Gemini returned an unusable response."],
  invalid_generated_schema: [
    502,
    "The generated knowledge did not match the required structure.",
  ],
  invalid_source_references: [
    502,
    "The generated knowledge references sources outside the supplied evidence.",
  ],
  invalid_relationship_endpoints: [
    502,
    "A generated relationship refers to an invalid concept.",
  ],
} as const;

export class GenerationFailure extends Error {
  readonly status: number;

  constructor(readonly code: keyof typeof failures) {
    super(failures[code][1]);
    this.status = failures[code][0];
  }
}
