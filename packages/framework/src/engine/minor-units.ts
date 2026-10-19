// 2 decimal places (cents) — covers every currently-supported currency
// (EUR/USD/GBP/...). No ISO-4217 minor-unit table yet (JPY=0, BHD=3) —
// upgrade path once a currency needing a different scale actually lands.
// Client-safe on purpose: db/money.ts pulls in engine runtime values.
export const MINOR_UNIT_SCALE = 100;

export function toMinorUnits(amount: number): number {
  return Math.round(amount * MINOR_UNIT_SCALE);
}
