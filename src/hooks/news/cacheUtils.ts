import { NewsItem } from "@/lib/core/types";

export const LOCAL_RESPONSE_TTL_MS = 60_000;
export const MAX_RESPONSE_CACHE_ENTRIES = 200;

export const responseCache = new Map<string, { data: NewsItem[]; isCapped: boolean; appliedLimit?: number; timestamp: number }>();
export const inFlightFetches = new Map<string, Promise<{ items: NewsItem[]; isCapped: boolean; appliedLimit?: number }>>();

export function pruneResponseCache(now = Date.now()) {
    for (const [key, cached] of responseCache.entries()) {
        if (now - cached.timestamp >= LOCAL_RESPONSE_TTL_MS) {
            responseCache.delete(key);
        }
    }

    while (responseCache.size > MAX_RESPONSE_CACHE_ENTRIES) {
        const oldestKey = responseCache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        responseCache.delete(oldestKey);
    }
}

export function computeSince(timeRange: string, customStartDate?: string): string | null {
    if (timeRange === 'custom') return customStartDate ? new Date(customStartDate).toISOString() : null;
    const ms: Record<string, number> = { '1d': 86400000, '3d': 259200000, '1w': 604800000, '1m': 2592000000 };
    return ms[timeRange] ? new Date(Date.now() - ms[timeRange]).toISOString() : null;
}

export function computeUntil(timeRange: string, customEndDate?: string): string | null {
    return (timeRange === 'custom' && customEndDate) ? new Date(customEndDate).toISOString() : null;
}
