/** Convert an instant for display without changing the underlying filter value. */
export function dateTimeInputValue(value?: string): string {
  if (!value) return '';
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
