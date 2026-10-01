import app from "vinext/server/fetch-handler";
import { dispatchDueNotifications } from "./lib/notifications-api";

type ScheduledController = { scheduledTime: number };
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };

const worker = {
  fetch(request: Request, bindings: unknown, context: unknown) {
    return app.fetch(request, bindings, context);
  },
  scheduled(controller: ScheduledController, _bindings: unknown, context: ExecutionContext) {
    context.waitUntil(dispatchDueNotifications(controller.scheduledTime));
  }
};

export default worker;
