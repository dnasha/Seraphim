import 'server-only';

import { supabaseAdmin } from '@/lib/core/supabase-admin';
import { createOperationsRecorder } from '@/lib/operationsCore';

export type { IncidentSeverity, MetricKind } from '@/lib/operationsCore';
export { serverDiagnostic } from '@/lib/operationsCore';

export const { recordMetric, recordIncident, recoverIncident } =
  createOperationsRecorder(supabaseAdmin);
