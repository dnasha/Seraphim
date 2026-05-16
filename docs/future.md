# Seraphim Roadmap

## Phase 4.4: UI Hardening & Visual Excellence
- [ ] **Micro-animations**: Implement smooth transitions for card entry, expansion, and map markers.
- [ ] **Glassmorphism**: Refine sidebar and overlays with modern translucent aesthetics.
- [ ] **Visual Consistency**: Audit all components for spacing, typography, and HSL token adherence.
- [ ] **Support & Help**: Add a Ko-fi support button and a help/onboarding button to the main interface.

## Phase 4.5: Candy Features
- [ ] **Temporal Scrubber**: Add a time slider to scrub through the last 7 days hour-by-hour with pin animations.
- [ ] **Drawing & Annotation**: Integrate `TerraDraw` for map-based sketches, measurement tools, and tactical overlays.
- [ ] **Data Export**: Support for GeoJSON, KML, and CSV exports for Pro users.
- [ ] **Dynamic OG Previews**: Use `@vercel/og` for map thumbnail previews in social shares.
- [ ] **AI Summarization (RAG)**: Use `pgvector` embeddings for natural language queries and LLM-generated event summaries.
- [ ] **Custom Layers**: Allow Pro users to toggle between Satellite, Topo, and Dark mode vector base layers.

## Phase 5: Distribution & Platform
- [ ] **Auth & Tiering**: Fully integrate Supabase Auth with Pro/Free tier enforcement.
- [ ] **Monetization**: Stripe Checkout integration for Pro tier subscriptions.
- [ ] **Geofence Alerts**: Edge Functions for email/push notifications based on user-defined polygons.
- [ ] **Premium Performance**: Implement Redis-backed querying for Pro users.

## Engineering Backlog
- [ ] **Server-Side Realtime Filtering**: Move news filtering logic to the database level to reduce egress.
- [ ] **Geodata Optimization**: Pre-calculate geocoding dictionaries at build time for faster runtime initialization.
- [ ] **Regional Heatmaps**: Visualize broad, unmapped news (e.g., country-wide) via polygon overlays.
- [ ] **The Tickertape**: Scrolling bottom bar for high-volume, unmapped headlines.
- [ ] **Realtime Scalability**: Rethink Supabase realtime connections for initial public launch to prevent connection exhaustion/system failure.