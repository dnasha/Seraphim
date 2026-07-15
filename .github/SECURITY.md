# Security policy

Seraphim processes untrusted public content, exposes internet-facing APIs, and includes authentication and paid-service boundaries. We appreciate careful security research that helps protect users, contributors, and the hosted service.

## Report vulnerabilities privately

**Do not open a public issue, discussion, or pull request for a suspected vulnerability.** Email [`feedback@seraphi.me`](mailto:feedback@seraphi.me) with the subject `Security report: <short summary>`.

If ordinary email is not suitable for the information you need to share, send a brief request for a more appropriate private channel before transmitting sensitive details.

Include as much of the following as you can:

- A concise description of the issue and its potential impact
- The affected URL, route, component, commit, or hosted-service flow
- Reproduction steps or a minimal proof of concept
- The account tier and environment used during testing
- Whether the issue is intermittent or consistently reproducible
- Suggested mitigations, if you have them
- Your preferred name or handle for attribution, or a request to remain anonymous

Please remove secrets, access tokens, personal data, and unrelated third-party content from logs and screenshots. Do not send destructive payloads or collected user data as proof.

## Supported surface

Security fixes are made against the current default branch and the currently deployed hosted service. Seraphim is pre-1.0 and does not maintain security-supported historical release lines. Self-hosted forks and modified deployments are maintained by their operators, though reports about vulnerabilities inherited from this repository are welcome.

Reports generally in scope include:

- Authentication, session, or authorization bypasses
- Cross-account access or exposure of private user data
- Server-side request forgery, injection, unsafe deserialization, or remote code execution
- Cross-site scripting or content-sanitization bypasses
- Payment, subscription, webhook, or entitlement bypasses with a security impact
- Credential, secret, or sensitive operational-data exposure
- Abuse paths that materially threaten service availability or data integrity
- Vulnerable dependencies with a demonstrable impact on Seraphim

The following are generally not security vulnerabilities by themselves:

- Incorrect, stale, biased, duplicated, or misleading third-party reporting
- Geocoding, categorization, clustering, or credibility-scoring inaccuracies without a security impact
- Missing best-practice headers without a practical exploit
- Self-XSS, clickjacking with no sensitive action, or findings requiring control of a victim's device
- Automated scanner output without reproduction or demonstrated impact
- Rate-limit observations that do not create a material abuse path
- Social engineering, physical attacks, denial-of-service stress testing, or attacks on third-party providers
- Issues that only affect an unsupported, materially modified fork

If you are uncertain whether a finding is in scope, report it privately and explain the concern.

## Research guidelines

To keep testing safe and eligible for the safe-harbor statement below:

- Use accounts and data you own or have explicit permission to test.
- Stop when you have demonstrated the issue; do not access additional records or establish persistence.
- Do not degrade availability, automate high-volume traffic, spam sources, or interfere with other users.
- Do not test payment methods that you do not own or attempt real financial fraud.
- Do not exfiltrate, retain, alter, or publicly disclose user data.
- Give us a reasonable opportunity to investigate and remediate before public disclosure.
- Follow applicable law and the terms of third-party services.

## What to expect

We aim to:

1. Acknowledge a complete report within three business days.
2. Triage it and request any missing reproduction details.
3. Keep you informed at meaningful points during investigation and remediation.
4. Coordinate disclosure after a fix or mitigation is available when the report is valid.

Response and remediation time vary with severity, reproducibility, affected dependencies, and operational risk. We may combine duplicate reports and cannot promise a reward or bounty. Attribution is offered when appropriate and requested.

## Safe harbor

When you make a good-faith effort to follow this policy, avoid privacy violations and service disruption, and report findings promptly, we will not pursue legal action against you for that research. If a third party initiates action related to compliant research, we will make reasonable efforts to clarify that your work followed this policy.

This safe harbor does not authorize testing against third-party systems and does not waive requirements imposed by applicable law.
