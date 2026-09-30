"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BBox } from "@/lib/core/types";
import type { UserTier } from "@/lib/entitlements";
import { regionFromViewport } from "@/lib/regions/geometry";
import {
  checkpointStorageKey,
  compareSnapshots,
  decodeCheckpoints,
  encodeCheckpoints,
  filterKey,
  MAX_REGIONS,
  reviewedSnapshot,
  validateFilters,
  type CheckpointSnapshot,
  type RegionFilters,
  type SavedCheckpoint,
} from "@/lib/regions/checkpoints";
import { readRegion } from "@/lib/regions/readRegion";

export interface DisplayedCheck {
  regionId: string;
  snapshot: CheckpointSnapshot;
  baselineCreated: boolean;
  resetForTier: boolean;
}
/** Mount with key=account:tier: auth changes synchronously discard all private UI. */
export function useRegionCheckpoints(account: string, tier: UserTier) {
  const expectedScope = `${account}:${tier}`;
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [regions, setRegions] = useState<SavedCheckpoint[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [displayed, setDisplayed] = useState<DisplayedCheck | null>(null);
  const regionsRef = useRef(regions);
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const key = checkpointStorageKey(account);
  const cancel = useCallback(() => {
    operation.current?.abort();
    operation.current = null;
    setPending(null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const load = () => {
      operation.current?.abort();
      operation.current = null;
      setPending(null);
      setDisplayed(null);
      try {
        const data = decodeCheckpoints(localStorage.getItem(key), account);
        regionsRef.current = data;
        setRegions(data);
        setError("");
        setReady(true);
        setLoadedScope(expectedScope);
      } catch {
        regionsRef.current = [];
        setRegions([]);
        setReady(false);
        setError(
          "Local checkpoints could not be read. Storage may be unavailable or invalid. Clear local checkpoints to recover.",
        );
        setLoadedScope(expectedScope);
      }
    };
    const timer = setTimeout(load, 0);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) load();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      operation.current?.abort();
      window.removeEventListener("storage", onStorage);
    };
  }, [account, key, expectedScope]);

  const persist = useCallback(
    (next: SavedCheckpoint[]) => {
      // Detect deletion or edits in another tab even before its storage event arrives.
      const current = decodeCheckpoints(localStorage.getItem(key), account);
      if (JSON.stringify(current) !== JSON.stringify(regionsRef.current))
        throw new Error(
          "Local checkpoints changed in another tab. Reopen checkpoints before editing.",
        );
      localStorage.setItem(key, encodeCheckpoints(next, account));
      regionsRef.current = next;
      setRegions(next);
      setError("");
    },
    [account, key],
  );
  const edit = useCallback(
    (change: (current: SavedCheckpoint[]) => SavedCheckpoint[]) => {
      if (loadedScope !== expectedScope) return;
      cancel();
      setDisplayed(null);
      try {
        persist(change(regionsRef.current));
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Local storage is unavailable. Nothing was saved.",
        );
      }
    },
    [cancel, persist, loadedScope, expectedScope],
  );
  const save = (name: string, bbox: BBox, filters: RegionFilters) =>
    edit((current) => {
      if (current.length >= MAX_REGIONS)
        throw new Error(
          `Save up to ${MAX_REGIONS} regions. Delete one to make room.`,
        );
      return [
        ...current,
        {
          region: regionFromViewport(
            bbox,
            name,
            crypto.randomUUID(),
            new Date().toISOString(),
          ),
          filters: validateFilters(filters),
          baseline: null,
        },
      ];
    });
  const rename = (id: string, name: string) =>
    edit((current) => {
      if (!name.trim() || name.length > 80)
        throw new Error("Use a name from 1 to 80 characters.");
      return current.map((r) =>
        r.region.id === id
          ? { ...r, region: { ...r.region, name: name.trim() } }
          : r,
      );
    });
  const remove = (id: string) =>
    edit((current) => current.filter((r) => r.region.id !== id));
  const reset = (id: string, filters?: RegionFilters) =>
    edit((current) =>
      current.map((r) =>
        r.region.id === id
          ? {
              ...r,
              filters: filters ? validateFilters(filters) : r.filters,
              baseline: null,
            }
          : r,
      ),
    );
  const clear = () => {
    cancel();
    setDisplayed(null);
    try {
      localStorage.removeItem(key);
      regionsRef.current = [];
      setRegions([]);
      setReady(true);
      setError("");
    } catch {
      setError(
        "Local storage could not be cleared. Check browser storage permissions.",
      );
    }
  };
  const check = async (id: string) => {
    cancel();
    setDisplayed(null);
    setError("");
    const region = regionsRef.current.find((r) => r.region.id === id);
    if (!region || !ready || loadedScope !== expectedScope) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(id);
    const timeout = setTimeout(
      () =>
        controller.abort(
          new Error("Region check timed out. Previous review is unchanged."),
        ),
      30_000,
    );
    try {
      const snapshot = await readRegion(region, tier, controller.signal);
      if (
        !mounted.current ||
        controller.signal.aborted ||
        operation.current !== controller
      )
        return;
      const baselineCreated =
        !region.baseline ||
        region.baseline.tier !== tier ||
        region.baseline.filterKey !== filterKey(region.filters);
      if (baselineCreated && !snapshot.coverage.stale) {
        const baseline = reviewedSnapshot(null, snapshot);
        persist(
          regionsRef.current.map((r) =>
            r.region.id === id ? { ...r, baseline } : r,
          ),
        );
      }
      setDisplayed({
        regionId: id,
        snapshot,
        baselineCreated: baselineCreated && !snapshot.coverage.stale,
        resetForTier: !!region.baseline && region.baseline.tier !== tier,
      });
    } catch (e) {
      if (mounted.current && operation.current === controller)
        setError(
          e instanceof Error
            ? e.message
            : "Region check failed. Previous review is unchanged.",
        );
    } finally {
      clearTimeout(timeout);
      if (mounted.current && operation.current === controller) {
        operation.current = null;
        setPending(null);
      }
    }
  };
  const review = () => {
    if (!displayed || pending || loadedScope !== expectedScope) return;
    try {
      const region = regionsRef.current.find(
        (r) => r.region.id === displayed.regionId,
      );
      if (!region) return;
      const baseline = reviewedSnapshot(region.baseline, displayed.snapshot);
      persist(
        regionsRef.current.map((r) =>
          r.region.id === region.region.id ? { ...r, baseline } : r,
        ),
      );
      setDisplayed({
        ...displayed,
        baselineCreated: true,
        resetForTier: false,
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Local storage is unavailable. Review was not saved.",
      );
    }
  };
  const baseline =
    regions.find((r) => r.region.id === displayed?.regionId)?.baseline ?? null;
  const changes = displayed
    ? compareSnapshots(baseline, displayed.snapshot)
    : [];
  const scopeReady = loadedScope === expectedScope;
  return {
    regions: scopeReady ? regions : [],
    ready: scopeReady && ready,
    error: scopeReady ? error : "",
    pending: scopeReady ? pending : null,
    displayed: scopeReady ? displayed : null,
    changes: scopeReady ? changes : [],
    save,
    rename,
    remove,
    reset,
    clear,
    check,
    review,
    cancel,
  };
}
