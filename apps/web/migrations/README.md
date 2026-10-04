# Notification database

Apply `0001_push_notifications.sql` to the `ltm-todo-notifications` D1 database before enabling Web Push. The app stores per-install push subscriptions and only the title and scheduled instant needed to deliver each reminder. Task editing remains local to the device.


This remains a per-install notification queue, not the app's task database. Deployed `main` still stores tasks and calendars in each browser's IndexedDB. The local v3 implementation adds a separate `ltm-todo-sync` D1 database for account-scoped task sync; it does not move sync entities or feed subscriptions into this notification database.
