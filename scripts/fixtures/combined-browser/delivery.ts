/** Explicit mock transport: fixture interactions never prompt or notify the OS. */
import type { BrowserDeliveryAdapter } from '../../../src/features/browser-geofence/delivery';
import { calls } from './services';

export function browserDelivery(): BrowserDeliveryAdapter {
    return {
        inspect: async () => calls.permission,
        requestPermission: async () => { calls.prompts++; calls.permission = 'granted'; return 'granted'; },
        deliver: async ({ ids }, signal) => { if (signal.aborted) throw new Error('Fixture delivery aborted.'); calls.deliveries.push(ids); },
        clear: async () => {},
    };
}
