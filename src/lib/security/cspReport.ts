const ALLOWED_DIRECTIVE = /^[a-z][a-z0-9-]{0,79}$/;

export interface SafeCspReport {
  effectiveDirective: string;
  blockedOrigin: string;
  sourceOrigin: string;
}

function safeDirective(value: unknown) {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  return ALLOWED_DIRECTIVE.test(normalized) ? normalized : 'unknown';
}

function safeOrigin(value: unknown) {
  if (typeof value !== 'string' || !value || value === 'inline' || value === 'eval') {
    return typeof value === 'string' && (value === 'inline' || value === 'eval') ? value : 'unknown';
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ws:' || url.protocol === 'wss:'
      ? url.origin
      : url.protocol.slice(0, 24);
  } catch {
    return 'unknown';
  }
}

export function parseCspReport(body: unknown): SafeCspReport | null {
  if (!body || typeof body !== 'object') return null;
  const wrapped = body as Record<string, unknown>;
  const report = (wrapped['csp-report'] ?? wrapped) as Record<string, unknown>;
  if (!report || typeof report !== 'object') return null;

  return {
    effectiveDirective: safeDirective(report['effective-directive'] ?? report.effectiveDirective),
    blockedOrigin: safeOrigin(report['blocked-uri'] ?? report.blockedURL),
    sourceOrigin: safeOrigin(report['source-file'] ?? report.sourceFile),
  };
}
