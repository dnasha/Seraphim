import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;

/** Read every recent row rather than relying on PostgREST's default row cap. */
export async function readRecentEventPages(
  db: SupabaseClient,
  columns: string,
  since: string,
  embeddingsOnly = false,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = db.from('events').select(columns).gte('published_at', since);
    if (embeddingsOnly) query = query.not('embedding', 'is', null);
    const { data, error } = await query
      .order('published_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Recent event lookup failed: ${error.message}`);
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}
