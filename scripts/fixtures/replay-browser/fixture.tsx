import React from 'react';
import { createRoot } from 'react-dom/client';
import { HomeContent } from '@/components/layout/HomeContent';
import { changeFixture, fixtureRows } from './services';
import '@/app/globals.css';
import './fixture.css';

createRoot(document.getElementById('root')!).render(<><HomeContent /><div className="fixture-switches" aria-label="Fixture services">
    <button onClick={() => changeFixture({ rows: [...fixtureRows, { ...fixtureRows[0], id: 'late-response', title: 'Late fixture response' }] })}>Inject late response</button>
    <button onClick={() => changeFixture({ owner: 'fixture-other', tier: 'free', rows: [] })}>Switch to free account</button>
    <button onClick={() => changeFixture({ tier: 'analyst' })}>Use Analyst fixture</button>
</div></>);
