import 'server-only';

import { supabaseAdmin } from '@/lib/core/supabase-admin';

export type MetricKind = 'operational' | 'conversion';
export type IncidentSeverity = 'warning' | 'critical';

function serverDiagnostic(code: string, correlationId?: string | null) {
  if (typeof process !== 'undefined' && process.stderr) {
    process.stderr.write(`[seraphim:${code}]${correlationId ? ` correlation=${correlationId}` : ''}\n`);
  }
}

export async function recordMetric(input: {
  kind: MetricKind;
  service: string;
  name: string;
  count?: number;
  value?: number;
}) {
  const { error } = await supabaseAdmin.rpc('increment_service_metric', {
    p_metric_kind: input.kind,
    p_service: input.service,
    p_metric_name: input.name,
    p_count: input.count ?? 1,
    p_value: input.value ?? 0,
  });
  if (error) serverDiagnostic('metric_write_failed');
}

export async function recordIncident(input: {
  dedupKey: string;
  service: string;
  type: string;
  severity: IncidentSeverity;
  correlationId?: string | null;
  safeContext?: Record<string, string | number | boolean | null>;
}) {
  const { error } = await supabaseAdmin.rpc('upsert_operational_incident', {
    p_dedup_key: input.dedupKey,
    p_service: input.service,
    p_incident_type: input.type,
    p_severity: input.severity,
    p_correlation_id: input.correlationId ?? null,
    p_safe_context: input.safeContext ?? {},
  });
  if (error) serverDiagnostic('incident_write_failed', input.correlationId);
}

export async function recoverIncident(dedupKey: string) {
  const { error } = await supabaseAdmin
    .from('operational_incidents')
    .update({ status: 'recovered', recovered_at: new Date().toISOString() })
    .eq('dedup_key', dedupKey)
    .neq('status', 'recovered');
  if (error) serverDiagnostic('incident_recovery_write_failed');
}

export { serverDiagnostic };
