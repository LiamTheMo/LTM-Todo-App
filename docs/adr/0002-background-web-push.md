# ADR 0002 — Background web reminders use Web Push

## Status
Accepted for the v1.00 notification fix.

## Decision
Keep task data authoritative and local on each device. Add a narrow Cloudflare D1 service for opt-in Web Push subscriptions and scheduled reminder delivery. A per-install random bearer token protects device schedule updates; only its SHA-256 hash is stored. A minute Cron Trigger claims due reminders and sends encrypted Web Push payloads authenticated with a stable VAPID key pair. Reminders are delivered through the responsive web app's browser notification support; no native Apple notification client is maintained.

The D1 service stores the device push endpoint/keys and a hash used to prevent duplicate device subscriptions, the reminder title and trigger instant, delivery retry state, and hashed registration rate-limit identifiers. It does not receive notes, projects, tags, or the full task document. Disabling push deletes that device subscription and its queued reminders. Inactive devices are pruned after 180 days.

## Consequences
- Browser push can reach a device when the app is backgrounded or closed, subject to network access, permission, and push-service delivery.
- The app must be online to sync edits/cancellations to the server queue. Reopening the app reconciles the queue from the local task data.
- Delivery is checked once per minute, and push services may add further delay.
- Each browser installation manages its own subscription and reminder queue; this does not add cross-device task sync.
- Production requires a D1 database and a stable VAPID key pair configured as Cloudflare bindings/variables/secrets.
- Reminder titles and scheduled instants are sent to Cloudflare for delivery; the Settings screen discloses this before enabling push.

## Alternatives considered
- In-page timers cannot reliably run after the app closes and were silently dropping reminders when a tab was hidden.
- Scheduling all notifications only on the device is unavailable to ordinary web apps and is not a supported cross-browser Web API.
- Full account-based task sync would add authentication and synchronization scope that is not needed for a per-device reminder queue.
