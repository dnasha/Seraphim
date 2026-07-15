## Summary

<!-- In 2–5 bullets, explain what changed and the outcome. -->

-

## Why

<!-- What problem does this solve? Link an issue with `Closes #123` when applicable. -->

## Change type

- [ ] Bug fix
- [ ] Feature
- [ ] Performance or reliability
- [ ] Security hardening
- [ ] Documentation
- [ ] Tests or developer experience
- [ ] Refactor with no intended behavior change
- [ ] Breaking change

## Verification

<!-- List exact commands and focused manual flows. Include relevant results, not only "tests pass." -->

```text
bun run lint
bun run test
```

- [ ] I added or updated tests for changed behavior.
- [ ] I ran `bun run test:accuracy` if geocoding, NLP, or location scoring changed.
- [ ] I ran `bun run build` if application or build behavior changed.
- [ ] I checked desktop and narrow/mobile layouts if UI changed.
- [ ] I tested unauthenticated and least-privileged access if auth, billing, entitlements, APIs, or user data changed.

## Visual evidence

<!-- Add before/after screenshots or a short recording for visible changes. Remove this section when not applicable. -->

## Risk and rollout

<!-- What could regress? Note compatibility, performance, data, migration, provider, or rollback considerations. -->

**Risk level:** Low / Medium / High

**Rollback or fallback:**

## Security, privacy, and public boundary

- [ ] No secrets, personal data, customer-derived fixtures, or private operational details are included.
- [ ] Untrusted source content remains validated, bounded, and sanitized where applicable.
- [ ] Client-side gates are backed by server-side authorization where applicable.
- [ ] New data collection, retention, providers, and permissions are described above.
- [ ] Production-only schema or infrastructure changes are coordinated separately and are not exposed here.

## Documentation

- [ ] Public documentation was updated, or no public documentation change is needed.
- [ ] Comments describe why—not merely what—where the behavior is non-obvious.
- [ ] User-facing claims match implemented and available behavior.

## AI assistance

<!-- See CONTRIBUTING.md. Minor editor completion can be marked "None/materially none." -->

**Model/tool:**

**How it was used:**

**Human verification performed:**

- [ ] I understand and can explain every material change in this pull request.
- [ ] I reviewed the complete diff and independently verified AI-generated code, tests, and claims.
- [ ] No secrets, private documentation, customer data, or vulnerability details were shared with an AI system.

## Final checklist

- [ ] This pull request is focused and excludes unrelated cleanup.
- [ ] Types are strict and new `any` usage is justified.
- [ ] CI-relevant commands pass, or failures are explained above.
- [ ] I reviewed my own diff for correctness, accessibility, performance, and maintainability.
