import 'server-only';

export interface OverlayHealthStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set(
    key: string,
    value: unknown,
    options?: { ex?: number; nx?: boolean },
  ): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

interface OverlayHealthRecorderOptions {
  store?: OverlayHealthStore | null;
  recordFailure: (service: string, errorCode: string) => Promise<void>;
  recordRecovery: (service: string) => Promise<void>;
  onStoreError?: () => void;
  now?: () => number;
  cooldownMs?: number;
}

const STATE_TTL_SECONDS = 7 * 24 * 60 * 60;
const RECOVERY_LOCK_SECONDS = 30;

export function createOverlayHealthRecorder({
  store,
  recordFailure,
  recordRecovery,
  onStoreError,
  now = Date.now,
  cooldownMs = 5 * 60 * 1000,
}: OverlayHealthRecorderOptions) {
  const localState = new Map<string, 'degraded' | 'healthy'>();
  const localCooldownUntil = new Map<string, number>();
  const localRecovering = new Set<string>();

  const stateKey = (service: string) => `seraphim:overlay-health:v1:${service}:state`;
  const cooldownKey = (service: string) => `seraphim:overlay-health:v1:${service}:cooldown`;
  const recoveryKey = (service: string) => `seraphim:overlay-health:v1:${service}:recovery`;

  const localFailure = async (service: string, errorCode: string) => {
    localState.set(service, 'degraded');
    const current = now();
    if ((localCooldownUntil.get(service) ?? 0) > current) return;
    localCooldownUntil.set(service, current + cooldownMs);
    await recordFailure(service, errorCode);
  };

  const localRecovery = async (service: string) => {
    if (localState.get(service) !== 'degraded' || localRecovering.has(service)) return;
    localRecovering.add(service);
    localState.set(service, 'healthy');
    localCooldownUntil.delete(service);
    try {
      await recordRecovery(service);
    } finally {
      localRecovering.delete(service);
    }
  };

  const markFailure = async (service: string, errorCode: string) => {
    if (!store) return localFailure(service, errorCode);
    try {
      await store.set(stateKey(service), 'degraded', { ex: STATE_TTL_SECONDS });
      const acquired = await store.set(cooldownKey(service), '1', {
        ex: Math.max(1, Math.ceil(cooldownMs / 1000)),
        nx: true,
      });
      if (acquired === null) return;
      await recordFailure(service, errorCode);
    } catch {
      onStoreError?.();
      await localFailure(service, errorCode);
    }
  };

  const markHealthy = async (service: string) => {
    if (!store) return localRecovery(service);
    let recoveryLock = false;
    try {
      const currentState = await store.get<string>(stateKey(service));
      if (currentState !== 'degraded') return;

      const acquired = await store.set(recoveryKey(service), '1', {
        ex: RECOVERY_LOCK_SECONDS,
        nx: true,
      });
      if (acquired === null) return;
      recoveryLock = true;

      const stateAfterLock = await store.get<string>(stateKey(service));
      if (stateAfterLock !== 'degraded') return;
      await store.set(stateKey(service), 'healthy', { ex: STATE_TTL_SECONDS });
      await store.del(cooldownKey(service));
      await recordRecovery(service);
    } catch {
      onStoreError?.();
      await localRecovery(service);
    } finally {
      if (recoveryLock) {
        try {
          await store.del(recoveryKey(service));
        } catch {
          onStoreError?.();
        }
      }
    }
  };

  return { markFailure, markHealthy };
}
