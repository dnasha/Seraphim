# Security Policy

We take the security of Seraphim seriously. If you believe you have found a security vulnerability, please read this policy to understand how to report it and what to expect from us.

## Supported Versions

We actively support and patch security issues on the following versions:

| Version | Supported                |
| ------- | ------------------------ |
| < 1.0.x | Yes (Active Development) |

We recommend always running the latest version from the `main` branch to ensure you have the latest security patches and updates.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security-related bugs.** Instead, report security vulnerabilities privately.

### How to Report

Please send an email to **`feedback@seraphi.me`** with the following information:

1. **Description**: A detailed description of the vulnerability, including its potential impact.
2. **Steps to Reproduce**: Detailed steps, code snippets, or raw payloads required to reproduce the issue.
3. **Environment**: Details about the runtime environment (OS, browser, database setup) if applicable.
4. **Attribution**: Let us know if and how you would like to be credited (e.g., your name, GitHub handle, or website).

We will acknowledge receipt of your vulnerability report within **48 hours** and provide a tracking ID.

### Safe Harbor

We encourage responsible disclosure. If you act in good faith and adhere to this policy:

- We will not initiate legal action against you.
- We will work with you to understand and resolve the issue quickly.
- We will credit you for your discovery in our security release notes, unless you request anonymity.

## Scope of Scope & Vulnerability Handling

This policy applies to:

- The core Seraphim codebase (frontend and backend APIs).
- The database ingestion pipeline and geocoding modules.

### Response & Disclosure Timeline

1. **Acknowledge**: We will confirm receipt within 48 hours.
2. **Triage**: We will investigate the issue and assess its severity.
3. **Patch**: We will develop and test a fix.
4. **Deploy**: We will release the fix to production and merge it into the public repository.
5. **Disclose**: We will publish a security advisory or release notes detailing the fix, acknowledging your contribution.
