import app from "vinext/server/fetch-handler";
import { dispatchDueNotifications } from "./lib/notifications-api";

export { AccountSyncCoordinator } from "./lib/account-sync-coordinator";
import { dispatchAttachmentCleanup } from "./lib/attachment-cleanup";
import { dispatchIcsSubscriptionRefresh } from "./lib/ics-refresh";

type ScheduledController = { scheduledTime: number };
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };

const worker = {
  fetch(request: Request, bindings: unknown, context: unknown) {
    return app.fetch(request, bindings, context);
  },
  scheduled(controller: ScheduledController, _bindings: unknown, context: ExecutionContext) {
    context.waitUntil(Promise.all([
      dispatchDueNotifications(controller.scheduledTime),
      dispatchAttachmentCleanup(),
      dispatchIcsSubscriptionRefresh()
    ]).then(() => undefined));
  }
};

export default worker;
