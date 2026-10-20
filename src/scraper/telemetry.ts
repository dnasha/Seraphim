/** Observability must never prevent otherwise valid events from being ingested. */
export async function attemptIngestionTelemetry(
  operation: string,
  write: () => Promise<void>,
): Promise<void> {
  try {
    await write();
  } catch {
    process.stderr.write(`[seraphim:ingestion_telemetry_${operation}_failed]\n`);
  }
}
