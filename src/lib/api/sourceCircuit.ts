export function sourceCircuitKey(sourceType: string, sourceName: string) {
  return `${sourceType}\u0000${sourceName}`;
}

export function isSourceCircuitOpen(
  openCircuits: ReadonlySet<string> | undefined,
  sourceType: string,
  sourceName: string,
) {
  return openCircuits?.has(sourceCircuitKey(sourceType, sourceName)) ?? false;
}
