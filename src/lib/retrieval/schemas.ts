import { z } from "zod";

export const maxQueryLength = 300;
export const maxEvidenceLength = 2_000;
export const maxRetrievalResults = 12;

export const retrievalRequestSchema = z.strictObject({
  query: z.string().max(maxQueryLength).trim().min(1),
});

export const providerIdSchema = z.enum([
  "wikipedia",
  "tavily",
  "github",
  "official-docs",
]);

export const httpUrlSchema = z
  .string()
  .trim()
  .max(2_048)
  .refine((value) => {
    if (!/^https?:\/\//i.test(value) || /[\p{Cc}\s\\]/u.test(value))
      return false;
    const url = URL.parse(value);
    return (
      url !== null &&
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    );
  }, "Expected an HTTP(S) URL without credentials");

const timestamp = z.iso.datetime({ offset: true });
const metadataText = z.string().trim().min(1).max(500);

export const sourceMetadataSchema = z.object({
  provider: providerIdSchema,
  type: z.enum(["encyclopedia", "web", "repository", "official-documentation"]),
  name: metadataText,
  url: httpUrlSchema,
  author: metadataText.optional(),
  publishedAt: timestamp.optional(),
  updatedAt: timestamp.optional(),
  repository: z
    .object({
      fullName: metadataText,
      owner: metadataText.optional(),
      stars: z.number().int().nonnegative().optional(),
      language: metadataText.optional(),
    })
    .optional(),
});

export const retrievalResultSchema = z.object({
  id: z.string().regex(/^[a-f\d]{64}$/),
  title: metadataText,
  content: z.object({
    kind: z.enum(["extract", "snippet", "description"]),
    text: z.string().trim().min(1).max(maxEvidenceLength),
  }),
  source: sourceMetadataSchema,
  retrievedAt: timestamp,
  relevanceScore: z.number().min(0).max(1).optional(),
});

export const retrievalErrorSchema = z.object({
  provider: providerIdSchema,
  code: z.enum([
    "unavailable",
    "rate_limited",
    "timeout",
    "network",
    "upstream_error",
    "malformed_response",
    "cancelled",
  ]),
  message: z.string(),
  upstreamStatus: z.number().int().min(400).max(599).optional(),
});

export const retrievalResponseSchema = z.object({
  query: retrievalRequestSchema.shape.query,
  status: z.enum(["ok", "partial", "failed"]),
  providers: z.array(providerIdSchema),
  results: z.array(retrievalResultSchema),
  errors: z.array(retrievalErrorSchema),
});
