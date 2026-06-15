/**
 * Freshness helpers — compute stale_at and expires_at per volatility class.
 *
 * Three-state staleness machine:
 *   FRESH  → served as authoritative (now < stale_at)
 *   STALE  → served with "verify" flag, refresh enqueued (stale_at < now < expires_at)
 *   EXPIRED → not served as authoritative (now > expires_at)
 *
 * Cadences by volatility class:
 *   static       → stale after 11 months, expired after 13 months (HS edition changes ~5yr)
 *   annual       → stale after 9 months, expired after 13 months (MFN duty, country profiles)
 *   scheduled    → stale after 6 months, expired after 8 months (FTA phase-in rates)
 *   event_driven → stale after 14 days, expired after 30 days (compliance/NTMs)
 */

export type VolatilityClass = 'static' | 'annual' | 'scheduled' | 'event_driven';

interface FreshnessDates {
  staleAt:   Date;
  expiresAt: Date;
}

const CADENCES: Record<VolatilityClass, { staleDays: number; expireDays: number }> = {
  static:       { staleDays: 335, expireDays: 395 },
  annual:       { staleDays: 270, expireDays: 395 },
  scheduled:    { staleDays: 180, expireDays: 240 },
  event_driven: { staleDays: 14,  expireDays: 30  },
};

export function computeFreshness(
  volatilityClass: VolatilityClass,
  fetchedAt: Date = new Date(),
): FreshnessDates {
  const { staleDays, expireDays } = CADENCES[volatilityClass];
  return {
    staleAt:   addDays(fetchedAt, staleDays),
    expiresAt: addDays(fetchedAt, expireDays),
  };
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function isFresh(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  return new Date() < expiresAt;
}
