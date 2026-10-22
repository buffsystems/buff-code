import { expect, test } from "bun:test"
import { memoryStorage } from "../../test/storage"
import { createNotifications, notificationKey, pruneNotifications } from "./notifications"

test("counts unseen notifications per session and project until viewed", () => {
  const storage = memoryStorage()
  const notifications = createNotifications({ storage, scope: "local", now: () => 10 })
  notifications.append({ type: "turn-complete", session: "a", directory: "/repo", time: 10, viewed: false })
  notifications.append({ type: "error", session: "a", directory: "/repo", time: 10, viewed: false })
  notifications.append({ type: "turn-complete", session: "b", directory: "/repo", time: 10, viewed: true })
  expect(notifications.session.unseenCount("a")).toBe(2)
  expect(notifications.session.unseenHasError("a")).toBe(true)
  expect(notifications.project.unseenCount("/repo")).toBe(2)
  notifications.session.markViewed("a")
  expect(notifications.session.unseenCount("a")).toBe(0)
  expect(JSON.parse(storage.items.get("notification") ?? "{}").list).toHaveLength(3)
})

test("keeps a month and at most 500 notifications", () => {
  const month = 1000 * 60 * 60 * 24 * 30
  const old = { type: "turn-complete" as const, time: 0, viewed: false }
  expect(pruneNotifications([old, { ...old, time: month + 5 }], month + 10)).toHaveLength(1)
  expect(
    pruneNotifications(
      Array.from({ length: 600 }, () => ({ ...old, time: 1 })),
      1,
    ),
  ).toHaveLength(500)
})

test("a remote server's notifications are scoped like the Solid window's", () => {
  expect(notificationKey("local")).toBe("notification")
  expect(notificationKey("http://remote")).toBe("http://remote\u0000notification")
})
