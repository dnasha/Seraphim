# Seraphim Roadmap

This document captures product directions that are intentionally deferred. Experimental work should be developed and validated on `test` before any decision to promote it.

## Personalization and account state

- Saved views that restore filters, camera position, overlays, sort order, and time range.
- Durable event bookmarks with private notes, collections, export, and canonical-ID handling across story merges or event expiry.
- A “since your last visit” mode using lightweight per-view watermarks rather than per-user/per-event read rows.
- Follow evolving stories and notify on new corroboration, credibility changes, volume spikes, or material updates.
- Finish user geofences with names, filter rules, quiet hours, cooldowns, notification channels, and asynchronous delivery.
- Scheduled daily or periodic briefings generated from saved views and followed stories.
- Cloud-synced annotation workspaces containing drawings, text notes, pinned events, filters, and camera state.
- Incident boards/case files with a timeline, selected events, annotations, notes, exports, and read-only share links.
- Personal source controls: trusted, neutral, deprioritized, and muted sources.
- Personal noise controls for topics, phrases, locations, categories, and recurring low-value patterns.
- An optional, explainable “personal signal lens” that uses explicit saves/mutes and event embeddings to softly boost relevant stories without hiding the global feed.
- Analyst handover mode summarizing changes during a shift, unreviewed events, active incidents, and workspace notes.
- Later: shared team workspaces, assignments, comments, and shift handovers.

## Suggested packaging

- Free: synced preferences, basic bookmarks, one saved view, and basic “since last visit.”
- Pro: multiple saved views, followed stories, briefings, and several geofences.
- Analyst: cloud annotation workspaces, advanced alert rules, incident boards, and investigation exports.
- Future team tier: shared workspaces, assignments, comments, and collaborative handovers.
