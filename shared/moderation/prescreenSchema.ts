/**
 * §9.2.2 pre-screen output (both modes; R8-035 bounds corrected by R9-008). The model is constrained to
 * `PRESCREEN_JSON_SCHEMA` by structured outputs, but that JSON-schema subset has no maxItems, maxLength
 * or numeric ranges, so `validatePrescreenOutput` enforces them here. A violation is a schema failure:
 * the answer is never partially used.
 */
export const POLICY_CATEGORIES = [
  'sexual',
  'nudity',
  'sexual_minors',
  'violence_gore',
  'hate_symbols_or_slurs',
  'illegal_goods',
  'weapons',
  'drugs',
  'self_harm',
  'shocking',
] as const;
export const BRAND_KINDS = ['logo', 'wordmark', 'product', 'mascot'] as const;
export const PRESCREEN_LABELS = ['political', 'gambling', 'crypto', 'adult_services', 'qr_code'] as const;
export const REVIEWER_ATTENTION = ['none', 'check', 'likely_violation'] as const;
export const PRESCREEN_MAX_ITEMS = 10;
export const PRESCREEN_MAX_TEXT = 500;
export const PRESCREEN_MAX_SUMMARY = 200;

export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];
export type BrandKind = (typeof BRAND_KINDS)[number];
export type PrescreenLabel = (typeof PRESCREEN_LABELS)[number];
export type ReviewerAttention = (typeof REVIEWER_ATTENTION)[number];
export interface PrescreenOutput {
  readonly policy: Readonly<Record<PolicyCategory, number>>;
  readonly brands: readonly {
    readonly name: string;
    readonly kind: BrandKind;
    readonly confidence: number;
  }[];
  readonly people: readonly {
    readonly description: string;
    readonly possibly_real_public_figure: boolean;
    readonly name_if_confident: string | null;
  }[];
  readonly text: { readonly detected: string; readonly language: string; readonly translation_en: string };
  readonly labels: Readonly<Record<PrescreenLabel, boolean>>;
  readonly claims: readonly string[];
  readonly affiliation_claims: readonly string[];
  readonly summary: string;
  readonly reviewer_attention: ReviewerAttention;
  readonly reasons: readonly string[];
}

const strict = <P extends Record<string, unknown>>(properties: P) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const text = { type: 'string' } as const;
const score = { type: 'number' } as const;
const texts = { type: 'array', items: text } as const;

/** The structured-output schema sent with every request (shape only; bounds are ours). */
export const PRESCREEN_JSON_SCHEMA = strict({
  policy: strict(Object.fromEntries(POLICY_CATEGORIES.map((key) => [key, score]))),
  brands: {
    type: 'array',
    items: strict({ name: text, kind: { type: 'string', enum: [...BRAND_KINDS] }, confidence: score }),
  },
  people: {
    type: 'array',
    items: strict({
      description: text,
      possibly_real_public_figure: { type: 'boolean' },
      name_if_confident: { anyOf: [text, { type: 'null' }] },
    }),
  },
  text: strict({ detected: text, language: text, translation_en: text }),
  labels: strict(Object.fromEntries(PRESCREEN_LABELS.map((key) => [key, { type: 'boolean' }]))),
  claims: texts,
  affiliation_claims: texts,
  summary: text,
  reviewer_attention: { type: 'string', enum: [...REVIEWER_ATTENTION] },
  reasons: texts,
});

export type PrescreenValidation =
  | { readonly ok: true; readonly value: PrescreenOutput }
  | { readonly ok: false; readonly path: string; readonly reason: string };

class Invalid extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}`);
  }
}
function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Invalid(path, 'not an object');
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object))
    if (!keys.includes(key)) throw new Invalid(`${path}.${key}`, 'unknown key');
  for (const key of keys) if (!Object.hasOwn(object, key)) throw new Invalid(`${path}.${key}`, 'missing');
  return object;
}
/** Bounded in UTF-16 code units after NFC; the canonical (NFC) string is what is kept. */
function boundedText(value: unknown, path: string, max = PRESCREEN_MAX_TEXT): string {
  if (typeof value !== 'string') throw new Invalid(path, 'not a string');
  const normal = value.normalize('NFC');
  if (normal.length > max) throw new Invalid(path, `longer than ${max}`);
  return normal;
}
function unit(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Invalid(path, 'not a finite score in [0, 1]');
  return value;
}
function flag(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Invalid(path, 'not a boolean');
  return value;
}
function oneOf<T extends string>(value: unknown, path: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value))
    throw new Invalid(path, 'not an allowed value');
  return value as T;
}
function list<T>(value: unknown, path: string, item: (value: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) throw new Invalid(path, 'not an array');
  if (value.length > PRESCREEN_MAX_ITEMS) throw new Invalid(path, `more than ${PRESCREEN_MAX_ITEMS} items`);
  return value.map((entry, index) => item(entry, `${path}[${index}]`));
}

/** Strict: every key required, unknown keys rejected at every level, bounds and enums exact. */
export function validatePrescreenOutput(value: unknown): PrescreenValidation {
  try {
    const root = record(value, '$', [
      'policy',
      'brands',
      'people',
      'text',
      'labels',
      'claims',
      'affiliation_claims',
      'summary',
      'reviewer_attention',
      'reasons',
    ]);
    const policy = record(root.policy, '$.policy', POLICY_CATEGORIES);
    const labels = record(root.labels, '$.labels', PRESCREEN_LABELS);
    const detected = record(root.text, '$.text', ['detected', 'language', 'translation_en']);
    const output: PrescreenOutput = {
      policy: Object.fromEntries(
        POLICY_CATEGORIES.map((key) => [key, unit(policy[key], `$.policy.${key}`)]),
      ) as Record<PolicyCategory, number>,
      brands: list(root.brands, '$.brands', (entry, path) => {
        const brand = record(entry, path, ['name', 'kind', 'confidence']);
        return {
          name: boundedText(brand.name, `${path}.name`),
          kind: oneOf(brand.kind, `${path}.kind`, BRAND_KINDS),
          confidence: unit(brand.confidence, `${path}.confidence`),
        };
      }),
      people: list(root.people, '$.people', (entry, path) => {
        const person = record(entry, path, [
          'description',
          'possibly_real_public_figure',
          'name_if_confident',
        ]);
        return {
          description: boundedText(person.description, `${path}.description`),
          possibly_real_public_figure: flag(
            person.possibly_real_public_figure,
            `${path}.possibly_real_public_figure`,
          ),
          name_if_confident:
            person.name_if_confident === null
              ? null
              : boundedText(person.name_if_confident, `${path}.name_if_confident`),
        };
      }),
      text: {
        detected: boundedText(detected.detected, '$.text.detected'),
        language: boundedText(detected.language, '$.text.language'),
        translation_en: boundedText(detected.translation_en, '$.text.translation_en'),
      },
      labels: Object.fromEntries(
        PRESCREEN_LABELS.map((key) => [key, flag(labels[key], `$.labels.${key}`)]),
      ) as Record<PrescreenLabel, boolean>,
      claims: list(root.claims, '$.claims', (entry, path) => boundedText(entry, path)),
      affiliation_claims: list(root.affiliation_claims, '$.affiliation_claims', (entry, path) =>
        boundedText(entry, path),
      ),
      summary: boundedText(root.summary, '$.summary', PRESCREEN_MAX_SUMMARY),
      reviewer_attention: oneOf(root.reviewer_attention, '$.reviewer_attention', REVIEWER_ATTENTION),
      reasons: list(root.reasons, '$.reasons', (entry, path) => boundedText(entry, path)),
    };
    return { ok: true, value: output };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, path: error.path, reason: error.reason };
    throw error;
  }
}

/** The highest policy likelihood (the advisory risk is `min(100, round(80 · maxPolicy))`). */
export function maxPolicy(output: PrescreenOutput): number {
  return Math.max(...POLICY_CATEGORIES.map((key) => output.policy[key]));
}
