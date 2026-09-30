"use client";

import { useState, useRef, useEffect } from "react";
import type { BBox } from "@/lib/core/types";
import type { UserTier } from "@/lib/entitlements";
import type { RegionFilters } from "@/lib/regions/checkpoints";
import type { RegionSpec } from "@/lib/regions/geometry";
import { MAX_REGIONS, filtersAllowed } from "@/lib/regions/checkpoints";
import { useRegionCheckpoints } from "./useRegionCheckpoints";
import styles from "./RegionCheckpoints.module.css";

interface Props {
  account: string;
  tier: UserTier;
  viewport: BBox | null;
  filters: RegionFilters;
  onRegionPreview: (region: RegionSpec | null) => void;
}
const timeLabel = (iso: string) => new Date(iso).toLocaleString();
export default function RegionCheckpoints({
  account,
  tier,
  viewport,
  filters,
  onRegionPreview,
}: Props) {
  const checkpoint = useRegionCheckpoints(account, tier);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const region = checkpoint.regions.find((r) => r.region.id === active);
  useEffect(() => {
    onRegionPreview(open ? (region?.region ?? null) : null);
  }, [region, open, onRegionPreview]);
  useEffect(() => () => onRegionPreview(null), [onRegionPreview]);
  const result =
    checkpoint.displayed?.regionId === active ? checkpoint.displayed : null;
  const coverage = result?.snapshot.coverage;
  const close = () => {
    checkpoint.cancel();
    onRegionPreview(null);
    setOpen(false);
    button.current?.focus();
  };
  return (
    <div className={styles.container}>
      <button
        title="Open saved region checkpoints"
        ref={button}
        type="button"
        className={styles.launcher}
        aria-expanded={open}
        aria-controls="region-checkpoints-panel"
        onClick={() => (open ? close() : setOpen(true))}
      >
        Region checkpoints
      </button>
      {open && (
        <section
          id="region-checkpoints-panel"
          aria-label="Region checkpoints"
          className={styles.panel}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <div className={styles.heading}>
            <h2>Region checkpoints</h2>
            <button
              title="Close region checkpoints"
              type="button"
              onClick={close}
              aria-label="Close region checkpoints"
            >
              Close
            </button>
          </div>
          <p>
            Save a fixed map viewport and its filters. Check for changes, then
            explicitly mark the displayed snapshot reviewed.
          </p>
          <p className={styles.muted}>
            Private to this account in this browser. No cloud sync. Clearing
            browser data removes checkpoints. {checkpoint.regions.length}/
            {MAX_REGIONS} saved.
          </p>
          {checkpoint.error && (
            <p role="alert" className={styles.error}>
              {checkpoint.error}
            </p>
          )}
          <form
            className={styles.row}
            onSubmit={(e) => {
              e.preventDefault();
              if (viewport) checkpoint.save(name, viewport, filters);
            }}
          >
            <label className={styles.field}>
              Region name
              <input
                title="Name this saved viewport"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
                placeholder="e.g. Pacific watch"
              />
            </label>
            <button
              title="Save the current viewport and filters locally"
              type="submit"
              disabled={
                !checkpoint.ready ||
                !viewport ||
                !name.trim() ||
                checkpoint.regions.length >= MAX_REGIONS ||
                !filtersAllowed(filters, tier)
              }
            >
              Save viewport
            </button>
          </form>
          {!viewport && <p>Move the map to set a viewport.</p>}
          <ul className={styles.regions}>
            {checkpoint.regions.map((r) => (
              <li key={r.region.id}>
                <button
                  title="Show this saved region without moving the camera"
                  type="button"
                  aria-pressed={active === r.region.id}
                  onClick={() => {
                    checkpoint.cancel();
                    setActive(r.region.id);
                    setRenameName(r.region.name);
                    onRegionPreview(r.region);
                  }}
                >
                  {r.region.name}
                </button>
                <span className={styles.muted}>
                  {r.baseline
                    ? `Reviewed ${timeLabel(r.baseline.coverage.checkedAt)}`
                    : "No baseline yet"}
                </span>
              </li>
            ))}
          </ul>
          {region && (
            <div className={styles.detail}>
              <h3>{region.region.name}</h3>
              <p className={styles.muted}>
                Saved scope:{" "}
                {region.filters.timeRange === "custom"
                  ? `${region.filters.customStartDate} – ${region.filters.customEndDate}`
                  : region.filters.timeRange}
                ; sources {region.filters.sources.join(", ") || "none"};
                categories {region.filters.categories.join(", ") || "none"};
                credibility{" "}
                {region.filters.credibilityTiers.join(", ") || "none"}; minimum
                reports {region.filters.minVolume}
                {region.filters.query
                  ? `; search “${region.filters.query}”`
                  : ""}
                . Camera and current filters do not change this region.
              </p>
              <form
                className={styles.row}
                onSubmit={(e) => {
                  e.preventDefault();
                  checkpoint.rename(active!, renameName);
                }}
              >
                <label className={styles.field}>
                  Rename region
                  <input
                    title="Edit this region name"
                    value={renameName}
                    onChange={(e) => setRenameName(e.target.value)}
                    maxLength={80}
                    required
                  />
                </label>
                <button title="Save the edited name" type="submit">
                  Rename
                </button>
              </form>
              <div className={styles.row}>
                <button
                  title="Read current entitled individual events in the saved region"
                  type="button"
                  disabled={
                    !checkpoint.ready ||
                    !!checkpoint.pending ||
                    !filtersAllowed(region.filters, tier)
                  }
                  onClick={() => void checkpoint.check(region.region.id)}
                >
                  {checkpoint.pending === active
                    ? "Checking…"
                    : "Check changes"}
                </button>
                <button
                  title="Delete this region and its local baseline"
                  type="button"
                  onClick={() => {
                    checkpoint.remove(region.region.id);
                    setActive(null);
                    onRegionPreview(null);
                  }}
                >
                  Delete region
                </button>
              </div>
              {!filtersAllowed(region.filters, tier) && (
                <p role="status">
                  Saved filters are unavailable on this plan. Reset with current
                  filters to create a fresh baseline.
                </p>
              )}
              <details>
                <summary>Reset baseline</summary>
                <p>
                  The next successful fresh check establishes a baseline and
                  reports no changes.
                </p>
                <div className={styles.row}>
                  <button
                    title="Discard the baseline and retain the saved filters"
                    type="button"
                    onClick={() => checkpoint.reset(region.region.id)}
                  >
                    Reset saved scope
                  </button>
                  <button
                    title="Replace saved filters and discard the baseline"
                    type="button"
                    disabled={!filtersAllowed(filters, tier)}
                    onClick={() => checkpoint.reset(region.region.id, filters)}
                  >
                    Use current filters and reset
                  </button>
                </div>
              </details>
              {result && coverage && (
                <div aria-live="polite" className={styles.result}>
                  <p>
                    {coverage.stale
                      ? "Stale results. Review is disabled; the previous baseline is unchanged."
                      : result.baselineCreated
                        ? `${result.resetForTier ? "Plan changed. " : ""}Baseline saved. Future checks compare with this observation.`
                        : `${checkpoint.changes.length} changed events since the last review.`}
                  </p>
                  <p className={styles.muted}>
                    Observed {coverage.observedCount} individual events. Data
                    captured {timeLabel(coverage.capturedAt)}; checked{" "}
                    {timeLabel(coverage.checkedAt)}. Publication dates do not
                    define newness.
                  </p>
                  <p className={styles.muted}>
                    {coverage.capped
                      ? "Capped coverage: some matching events may be missing. Known identities and source fingerprints are retained."
                      : "Bounded coverage of currently available results. Missing events are not treated as removals."}{" "}
                    {coverage.timelineLimited &&
                      "Source visibility is limited by your plan."}{" "}
                    Limits {coverage.appliedLimits.join(" / ")} across{" "}
                    {coverage.readCount} read(s).
                  </p>
                  <p className={styles.muted}>
                    Merge lineage is unavailable. An event with shared report
                    identities is labelled “Identity changed / possible merge”;
                    newly observed IDs may also represent merges.
                  </p>
                  {!result.baselineCreated && (
                    <ul className={styles.changes}>
                      {checkpoint.changes.map((change) => (
                        <li key={change.event.id}>
                          <strong>{change.event.title}</strong>
                          <p>
                            {change.kinds
                              .map((k) =>
                                k === "event"
                                  ? "Newly observed event"
                                  : k === "identity"
                                    ? "Identity changed / possible merge"
                                    : k === "sources"
                                      ? `${change.addedSources} newly observed source(s)`
                                      : "Observable title or location correction",
                              )
                              .join(" · ")}
                          </p>
                          <p className={styles.muted}>
                            {change.event.location || "Unnamed location"}
                          </p>
                          {change.previous &&
                            change.kinds.includes("correction") && (
                              <p className={styles.muted}>
                                Previously: {change.previous.title} ·{" "}
                                {change.previous.location || "Unnamed location"}
                              </p>
                            )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    title="Mark only the displayed snapshot reviewed"
                    type="button"
                    disabled={
                      coverage.stale ||
                      result.baselineCreated ||
                      !!checkpoint.pending
                    }
                    onClick={checkpoint.review}
                  >
                    Mark reviewed
                  </button>
                  <p className={styles.muted}>
                    Reviews only this displayed snapshot. Later arrivals require
                    another check.
                  </p>
                </div>
              )}
            </div>
          )}
          <details>
            <summary>Local storage controls</summary>
            <p>
              Delete all saved regions and reviews for this account in this
              browser.
            </p>
            <button
              title="Remove all local checkpoints for this account"
              type="button"
              onClick={() => {
                checkpoint.clear();
                setActive(null);
                onRegionPreview(null);
              }}
            >
              Clear local checkpoints
            </button>
          </details>
        </section>
      )}
    </div>
  );
}
