# Contributing to Seraphim

Thank you for helping improve Seraphim. Contributions are welcome across the dashboard, ingestion pipeline, geocoding, tests, accessibility, performance, security, and documentation.

Seraphim is both an open-source project and an operated SaaS. Contributions should improve the public codebase without assuming access to production infrastructure, private database definitions, provider accounts, customer data, or internal runbooks.

## Before you start

- Search existing issues and pull requests before beginning substantial work.
- Open an issue first for large features, schema-dependent changes, new external services, or changes that affect product tiers.
- Keep pull requests focused. Separate unrelated refactors from behavior changes.
- Never include credentials, customer data, private operational details, copied publisher content, or generated artifacts with unclear licensing.
- Report vulnerabilities privately according to [the security policy](.github/SECURITY.md).

## Development setup

### Prerequisites

- Bun 1.3 or newer
- Git
- A compatible Supabase/PostgreSQL development project for data-backed flows

### Clone and install

```bash
git clone https://github.com/dnasha/Seraphim.git
cd Seraphim
bun install --frozen-lockfile
```

The compiled GeoNames lookup is committed. Rebuild it only when changing the raw geographic inputs:

```bash
bun run scripts/build/build-geodata.mjs
```

Start the application with:

```bash
bun run dev
```

The public repository does not include Seraphim's production schema or deployment configuration. You can work on most UI, parsing, geocoding, and unit-tested logic locally; complete data-backed flows require your own compatible development database and policies.

## Architecture guardrails

### Keep server-only code on the server

- `src/lib/geocoding/`, service-role database clients, ingestion modules, and secret-bearing integrations must not be imported into client components.
- Client components should use route handlers or narrowly defined server interfaces.
- The geocoding engine intentionally allows Bun, test, and benchmark contexts while remaining server-only in the application bundle.

### Preserve shared contracts

- URL state in `src/hooks/useViewState.ts` is the source of truth for map position, filters, time windows, sorting, and shared event links.
- Product access rules belong in the shared entitlement contract. A UI gate alone is not authorization; server routes must enforce the same rule.
- Event identity must remain stable across raw results, aggregated map results, detail lookups, and shared URLs.
- Keep source, category, and credibility presentation centralized in `src/lib/styles/colors.ts`.

### Respect data and source boundaries

- Treat source material as untrusted input. Preserve sanitization, bounded parsing, URL validation, and failure isolation.
- New sources need a clear public-interest use case, an appropriate credibility tier, stable attribution, and tests or diagnostics demonstrating useful output.
- Avoid copying full publisher content. Seraphim should point users to the original reporting and retain only what is necessary for aggregation and analysis.
- Do not add production endpoints, private migrations, operational thresholds, credentials, or customer-derived fixtures to the public repository.

### Match the interface

- Use CSS Modules and the shared design tokens in `src/app/globals.css` and related style modules.
- Preserve keyboard access, focus states, responsive behavior, and reduced-motion support.
- Include before/after screenshots or a short recording for visible UI changes.

## AI-assisted contributions

AI-assisted contributions are welcome, including code, tests, documentation, and review support, subject to all of the following:

1. **Use a current state-of-the-art model.** Use a frontier-quality model with strong, current coding and reasoning performance that is appropriate for the task. Do not submit low-quality bulk output from obsolete models, lightweight autocomplete, or unverified agent runs.
2. **Understand every change.** You are the author of the contribution. You must be able to explain the design, behavior, edge cases, and security implications without relying on the model's explanation.
3. **Verify thoroughly.** Inspect the complete diff, run the relevant test and quality commands, exercise affected user flows, and check claims against the current repository. Generated tests do not count as verification unless you have reviewed what they actually prove.
4. **Disclose material assistance.** In the pull request, name the model/tool and briefly describe how it was used. Minor editor completion does not need a detailed transcript; generated implementations, migrations, tests, or substantial prose do.
5. **Protect sensitive data.** Do not send secrets, private documentation, vulnerability details, customer data, or non-public production information to a model or include them in prompts, fixtures, or transcripts.
6. **Respect licensing and attribution.** Do not submit model output that reproduces third-party code, text, imagery, or data without compatible rights and attribution.

Maintainers may ask for additional tests, a design explanation, or a human-authored revision. Unreviewed AI output, unverifiable claims, prompt-dump pull requests, and changes whose author cannot explain them may be closed.

## Testing and quality

Run the smallest relevant tests while iterating, then the repository checks appropriate to your change:

```bash
bun run lint
bun run test
bun run test:coverage
bun run build
```

For geocoding or location-scoring changes, also run:

```bash
bun run test:accuracy
```

Review the regression output rather than relying only on the exit code. Add focused cases for both the intended match and nearby false-positive risks.

Additional expectations:

- Add or update tests for changed behavior.
- Keep TypeScript strict; avoid `any` unless an external boundary makes it unavoidable and the reason is documented.
- Confirm UI changes at desktop and narrow/mobile widths.
- Test unauthenticated and least-privileged behavior when changing auth, billing, entitlements, API routes, or user-owned data.
- Treat warnings, flaky behavior, and silent fallback paths as findings to investigate—not noise to ignore.

## Pull request process

1. Branch from the current default branch using a descriptive name such as `feature/source-health` or `fix/shared-event-selection`.
2. Make focused commits with clear messages.
3. Complete the pull request template, including risk, verification, documentation, and AI-assistance sections.
4. Link the issue the change addresses when one exists.
5. Ensure CI passes and respond to review with follow-up commits rather than hiding material changes in force-pushed history during active review.
6. Be prepared to revise scope. A technically correct change may still need adjustment for product fit, public/private boundaries, maintainability, or source quality.

By contributing, you agree that your work is provided under the repository's [GNU AGPL v3.0 license](LICENSE).
