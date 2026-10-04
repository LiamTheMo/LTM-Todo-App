import { env } from "cloudflare:workers";
import { CloudflarePinnedFeedTransport, cloudflareFeedResolver } from "./cloudflare-pinned-feed-transport.ts";
import { D1IcsSubscriptionStore } from "./ics-subscriptions.ts";

/** Refreshes a small due-feed batch each minute; persisted backoff prevents retry storms. */
export async function dispatchIcsSubscriptionRefresh(): Promise<void> {
  if (!env.ICS_FEED_ENCRYPTION_KEY) return;
  const store = new D1IcsSubscriptionStore(env.SYNC_DB, env.ICS_FEED_ENCRYPTION_KEY, cloudflareFeedResolver,
    new CloudflarePinnedFeedTransport());
  await store.refreshDue(5);
}
