import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbEvent } from "@/types";

export interface BulkIngestResult {
  upserted_count: number;
  merged_count: number;
}

export function isVectorTypeMissingError(message?: string | null): boolean {
  return /type\s+"vector"\s+does not exist/i.test(message ?? "");
}

export function stripEmbedding(event: DbEvent): Omit<DbEvent, "embedding"> {
  // Keep inserts compatible when pgvector is unavailable.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { embedding: _embedding, ...eventWithoutEmbedding } = event;
  return eventWithoutEmbedding;
}

export async function ingestSequentially(
  db: SupabaseClient,
  eChunk: DbEvent[],
  mChunk: { id: string; [key: string]: unknown }[],
  omitEmbedding: boolean,
  vectorTypeUnavailable: boolean,
): Promise<{ upserted_count: number; merged_count: number; vectorTypeUnavailable: boolean }> {
  let upserted_count = 0;
  let merged_count = 0;
  let vtUnavailable = vectorTypeUnavailable;

  for (const merge of mChunk) {
    const { error: mErr } = await db
      .from("events")
      .update(merge as Partial<DbEvent>)
      .eq("id", merge.id);
    if (!mErr) {
      merged_count++;
    } else {
      throw new Error(`Sequential merge failed for ${merge.id}: ${mErr.message}`);
    }
  }

  for (const event of eChunk) {
    let payload: Partial<DbEvent> = omitEmbedding
      ? stripEmbedding(event)
      : event;
    let { error: iErr } = await db.from("events").insert(payload);

    if (
      iErr &&
      !omitEmbedding &&
      isVectorTypeMissingError(iErr.message)
    ) {
      vtUnavailable = true;
      payload = stripEmbedding(event);
      ({ error: iErr } = await db.from("events").insert(payload));
    }

    if (!iErr) {
      upserted_count++;
    } else {
      throw new Error(`Sequential insert failed for ${event.url}: ${iErr.message}`);
    }
  }

  return {
    upserted_count,
    merged_count,
    vectorTypeUnavailable: vtUnavailable,
  };
}
