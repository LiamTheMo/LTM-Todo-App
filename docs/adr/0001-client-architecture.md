# ADR 0001: Native Apple Client + First-Class Web Client

## Status
Accepted for initial architecture.

## Context
LTM Todo targets iPhone, iPad and web. Apple clients benefit materially from native notifications, widgets, background behavior, accessibility and platform conventions. The web client requires excellent browser behavior and should not be constrained by a mobile wrapper.

## Decision
Use SwiftUI for iPhone/iPad and React/Next.js for web. Do not share presentation code. Share domain behavior through specifications, versioned schemas, fixtures and conformance tests. Use local-first persistence on each client and add server synchronization in v3.

## Consequences
Two presentation implementations require discipline to keep semantics aligned. In return, each platform can behave natively and domain/sync design remains independent of a cross-platform UI framework.
