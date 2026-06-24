## Description

Please include a comprehensive summary of the changes, the problem solved, and any relevant motivation and context. If applicable, specify which issues are resolved by this pull request.

Fixes # (issue number)

---

## Type of Change

Please tick the options that are relevant to this pull request:

- [ ] **Bug Fix** (non-breaking change which fixes an issue)
- [ ] **New Feature** (non-breaking change which adds functionality)
- [ ] **Performance Optimization** (changes that improve memory usage, bundle size, or speed)
- [ ] **Breaking Change** (fix or feature that would cause existing functionality to behave differently)
- [ ] **Documentation Update** (changes to README, guides, or comments)
- [ ] **CI/CD / Developer Experience** (adjustments to scripts, tests, actions, or lints)

---

## Technical Constraints Check

- [ ] **Server-Only Isolation**: My changes do not import server-only geocoding or database logic (from `src/lib/geocoding/` or service-role clients) into client components.
- [ ] **View State Integrity**: Viewport and filter state modifications are synced properly with the URL using `useViewState`.
- [ ] **Design System Consistency**: Corner radius styles adhere to the `4px`/`8px`/`12px` constraints (no raw pill styles), and colors leverage the centralized design tokens.

---

## How Has This Been Tested?

Please describe the tests you ran to verify your changes. Provide details on how to reproduce them.

### Automated Test Runs
- [ ] `bun run test` (All unit/integration tests pass)
- [ ] `bun run test:accuracy` (Geocoding accuracy results verified, if modifying geodata/NLP engine)
- [ ] `bun run test:coverage` (Code coverage limits checked)

### Manual Verification
- [ ] Built the Next.js app locally using `bun run build` (No compile/Google Fonts fetch issues)
- [ ] Verified UI on desktop viewport (`localhost:3000`)
- [ ] Verified UI responsiveness on mobile/narrow viewports
- [ ] Verified keyboard navigation / focus styling behaves correctly

---

## Contributor Checklist

- [ ] My code follows the TypeScript strict guidelines of this project (no implicit/explicit `any`).
- [ ] I have ran `bun run lint` and resolved all styling and static analysis warnings.
- [ ] I have self-reviewed my own code for efficiency, readability, and security.
- [ ] I have updated corresponding documentation or inline comments for complex sections.
- [ ] My changes generate no new warnings or console errors.
