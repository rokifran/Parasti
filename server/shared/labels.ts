// Shared label rules. Pure functions only; the two backends own their db calls.

export const LABEL_NAME_MAX = 40;
export const MAX_LABELS_PER_ITEM = 20;

export function validateLabelName(raw: unknown): { error: string } | { value: string } {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return { error: 'Label name is required' };
  if (name.length > LABEL_NAME_MAX) return { error: 'Label name is too long' };
  return { value: name };
}

// Reads `label_ids` from an item body (POST /tasks, PATCH /tasks/:id, POST
// /events, PUT /events/:id, PUT /pages/:id). Absent key => undefined (labels
// untouched). Present key must be an array of label ids; duplicates removed.
export function extractLabelIds(
  body: Record<string, unknown>
): { error: string } | { value: string[] | undefined } {
  if (body.label_ids === undefined) return { value: undefined };
  if (!Array.isArray(body.label_ids)) return { error: 'Invalid labels' };
  const ids = [...new Set(
    body.label_ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
  )];
  if (ids.length > MAX_LABELS_PER_ITEM) return { error: 'Too many labels' };
  return { value: ids };
}

export const LABEL_COLORS = ['terracotta', 'biru', 'olive', 'plum', 'teal', 'cokelat'] as const;

export type LabelColor = (typeof LABEL_COLORS)[number];

// undefined/null/'' => null (no color). A present value must be a palette key.
export function validateLabelColor(raw: unknown): { error: string } | { value: LabelColor | null } {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  if (typeof raw !== 'string' || !(LABEL_COLORS as readonly string[]).includes(raw)) {
    return { error: 'Invalid color' };
  }
  return { value: raw as LabelColor };
}
