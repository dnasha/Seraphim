import React from 'react';
import { createRoot } from 'react-dom/client';
import { HomeContent } from '@/components/layout/HomeContent';
import '../../../src/app/globals.css';
import './fixture.css';
import { qa } from './fixture';

// Strictly intercept local API reads: no production connection or outbound source fetch.
window.fetch = async (input, options) => {
  const url = String(input);
  if (options?.signal?.aborted) throw options.signal.reason;
  if (url === '/api/analyst/access') {
    const userId = qa.getOwner(); const tier = qa.getTier();
    return Response.json({ userId, tier }, { status: !userId ? 401 : tier === 'analyst' || tier === 'angel' ? 200 : 403 });
  }
  if (url.startsWith('/api/news/')) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 250);
      options?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal?.reason); }, { once: true });
    });
    const id = url.split('/').pop()!.split('?')[0];
    if (id.endsWith('000000000003')) return Response.json({ error: 'Fixture outage' }, { status: 503 });
    return Response.json(qa.detail(id));
  }
  throw new Error(`Fixture blocks unmocked request: ${url}`);
};
Object.assign(window, { analystQA: qa });
createRoot(document.getElementById('root')!).render(<HomeContent />);
