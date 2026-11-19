/** `?year=` (IA §6); invalid values fall back to the API default (current year). */
export function parseYear(value: string | null): number | undefined {
  if (!value || !/^\d{4}$/.test(value)) return undefined;
  const year = Number(value);
  return year >= 2000 && year <= 2100 ? year : undefined;
}
