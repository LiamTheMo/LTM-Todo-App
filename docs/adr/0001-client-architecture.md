# ADR 0001: Responsive Web Client

## Status
Accepted. The responsive web app is the only maintained and supported client.

## Context
LTM Todo needs a supported experience across desktop, iPhone and iPad. The responsive web client can be installed to the Home Screen on supported mobile browsers. The repository previously included a SwiftUI project, but it could not be distributed as a usable personal iOS app through the existing GitHub build pipeline.

## Decision
Use TypeScript/React for the supported client and IndexedDB for local task data. Keep domain semantics testable independently from UI. Remove the native Apple app source, Swift package and native build/test workflows. Add accounts and cross-device synchronization in v3 without blocking local-first writes.

## Consequences
The responsive web app is the single maintained client. Its data remains local per browser until the v3 sync protocol and service are implemented. Web Push is a per-install reminder-delivery service, not a synchronization mechanism. iPhone/iPad access uses the responsive site and Home Screen installation on supported browsers.
