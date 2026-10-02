# ADR 0001: Responsive Web Client and Experimental Apple Source

## Status
Accepted for the current v1/v2 release path; revisit before making the native app a supported product.

## Context
LTM Todo targets desktop browsers, iPhone, and iPad. The current shipped app is the responsive web client and can be installed to the mobile Home Screen. The repository also retains a SwiftUI app, but GitHub Actions does not build, sign, or distribute it and the supported release process does not depend on it.

## Decision
Use TypeScript/React for the supported web experience and IndexedDB for local task data. Keep domain semantics testable independently from UI. Treat `apps/apple` as experimental source only until a future product decision and distribution/validation path are approved. Add accounts and cross-device synchronization in v3 without blocking local-first writes.

## Consequences
The web app is the single supported client in v1/v2. Its data remains local per browser until the v3 sync protocol and service are implemented. Web Push is a per-install reminder-delivery service, not a synchronization mechanism. Native SwiftUI behavior must not be described as shipped or covered by the current Apple policy CI check.