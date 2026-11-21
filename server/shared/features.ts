// Optional modules controlled by the FEATURES env var. Both backends parse the
// same value the same way (plan-04a T7/T8).

export const KNOWN_FEATURES = ['tasks', 'google'] as const;

export type KnownFeature = (typeof KNOWN_FEATURES)[number];

// Default (env absent or empty) = every module enabled, so existing installs
// keep working without configuration. "none" turns everything off.
export function parseFeatures(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [...KNOWN_FEATURES];
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'none') return [];

  const features: string[] = [];
  for (const part of normalized.split(',')) {
    const name = part.trim();
    if ((KNOWN_FEATURES as readonly string[]).includes(name) && !features.includes(name)) {
      features.push(name);
    }
  }
  return features;
}
