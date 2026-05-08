import { RSS_SOURCES, REDDIT_SOURCES, TELEGRAM_CHANNELS, X_ACCOUNTS } from '../src/data/sources';
import { fetchSingleFeed, fetchRedditFeed } from '../src/scraper/fetchers/rss';
import { scrapeTelegramChannel, fetchXFeed } from '../src/scraper/fetchers/social-feeds';
import { NewsItem } from '../src/lib/types';

interface AuditedItem extends NewsItem {
    _originSource: string;
}

async function auditSources() {
    console.log('Starting Source Audit...');
    const allItems: AuditedItem[] = [];

    // RSS
    console.log('Auditing RSS...');
    for (const s of RSS_SOURCES) {
        try {
            const items = await fetchSingleFeed(s);
            const audited = items.map(i => ({ ...i, _originSource: s.name }));
            allItems.push(...audited);
        } catch {}
    }

    // Reddit
    console.log('Auditing Reddit...');
    for (const s of REDDIT_SOURCES) {
        try {
            const items = await fetchRedditFeed(s);
            const audited = items.map(i => ({ ...i, _originSource: s.name }));
            allItems.push(...audited);
        } catch {}
    }

    // Telegram & X
    console.log('Auditing Social...');
    for (const s of TELEGRAM_CHANNELS) {
        try {
            const items = await scrapeTelegramChannel(s);
            const audited = items.map(i => ({ ...i, _originSource: s.name }));
            allItems.push(...audited);
        } catch {}
    }
    for (const s of X_ACCOUNTS.slice(0, 5)) {
        try {
            const items = await fetchXFeed(s);
            const audited = items.map(i => ({ ...i, _originSource: s.name }));
            allItems.push(...audited);
        } catch {}
    }

    console.log(`Total items fetched for audit: ${allItems.length}`);
    
    const anomalies: { source: string; field: string; type: string; value: unknown }[] = [];
    for (const item of allItems) {
        if (typeof item.title !== 'string' && item.title !== undefined) {
            anomalies.push({ source: item._originSource, field: 'title', type: typeof item.title, value: item.title });
        }
        if (typeof item.description !== 'string' && item.description !== undefined) {
            anomalies.push({ source: item._originSource, field: 'description', type: typeof item.description, value: item.description });
        }
    }

    if (anomalies.length > 0) {
        console.log('--- FOUND ANOMALIES ---');
        console.table(anomalies);
    } else {
        console.log('No raw type anomalies found in sampled items.');
    }
}

auditSources();
