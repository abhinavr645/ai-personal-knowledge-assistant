import { z } from "zod";

const plainText = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (text) => !/\b(?:[a-z][a-z\d+.-]*:\/\/|www\.)\S/iu.test(text),
      "Use source IDs for citations",
    );
const evidenceId = z.string().trim().min(1).max(80);
const itemId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(70);
const claim = (max: number) => ({
  text: plainText(max),
  kind: z.enum(["evidence", "synthesis"]),
  sourceIds: z.array(evidenceId).min(1).max(4),
});

const explanation = z.strictObject({
  title: plainText(180),
  summary: z.strictObject(claim(500)),
  detail: z.strictObject(claim(3_000)),
  sections: z
    .array(z.strictObject({ heading: plainText(120), ...claim(900) }))
    .max(4),
  takeaways: z
    .array(z.strictObject(claim(240)))
    .min(1)
    .max(6),
});

const concept = z.strictObject({
  id: itemId,
  name: plainText(120),
  description: plainText(400),
  category: z.enum([
    "Field",
    "Method",
    "Learning approach",
    "Tool",
    "Principle",
    "Other",
  ]),
  sourceIds: z.array(evidenceId).max(4),
});

const relationship = z.strictObject({
  id: itemId,
  sourceConceptId: itemId,
  targetConceptId: itemId,
  type: z.enum([
    "IS_A",
    "PART_OF",
    "USES",
    "DEPENDS_ON",
    "RELATED_TO",
    "IMPLEMENTS",
    "EXTENDS",
  ]),
  explanation: plainText(360),
  sourceIds: z.array(evidenceId).min(1).max(4),
});

export const modelKnowledgeSchema = z.strictObject({
  evidenceStatus: z.enum(["sufficient", "limited", "insufficient"]),
  evidenceNote: plainText(360, 0),
  explanation: explanation.nullable(),
  concepts: z.array(concept).max(8),
  relationships: z.array(relationship).max(16),
});

export type ModelKnowledge = z.infer<typeof modelKnowledgeSchema>;

// Gemini supports a subset of JSON Schema. Keep local Zod string constraints
// and semantic checks authoritative while sending the supported shape.
export const knowledgeJsonSchema = z.toJSONSchema(modelKnowledgeSchema, {
  override: ({ jsonSchema }) => {
    delete jsonSchema.minLength;
    delete jsonSchema.maxLength;
    delete jsonSchema.pattern;
  },
});
delete knowledgeJsonSchema.$schema;
