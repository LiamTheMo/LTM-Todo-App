# Notification database

Apply `0001_push_notifications.sql` to the `ltm-todo-notifications` D1 database before enabling Web Push. The app stores per-install push subscriptions and only the title and scheduled instant needed to deliver each reminder. Task editing remains local to the device.


This is a per-install notification queue, not the app's task database. Task and calendar records remain in browser IndexedDB; cross-device task synchronization is not implemented.