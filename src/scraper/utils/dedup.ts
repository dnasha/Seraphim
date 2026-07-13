export function parseExistingUrlRows(rows: unknown): string[] {
  if (!Array.isArray(rows)) {
    throw new Error("Deduplication RPC returned a non-array response");
  }

  return rows.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new Error(`Deduplication RPC returned an invalid row at index ${index}`);
    }

    const record = row as { existing_url?: unknown; url?: unknown };
    const value = typeof record.existing_url === "string"
      ? record.existing_url
      : record.url;

    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Deduplication RPC row ${index} is missing an existing URL`);
    }

    return value;
  });
}
