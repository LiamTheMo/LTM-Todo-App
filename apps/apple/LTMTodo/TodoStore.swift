import Foundation
import Combine
import UserNotifications

@MainActor
final class TodoStore: ObservableObject {
    @Published private(set) var data = TodoData()
    @Published private(set) var errorMessage: String?
    private let url: URL

    init() {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        url = folder.appendingPathComponent("LTM-Todo-v1.json")
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: url.path) {
                let decoded = try JSONDecoder().decode(TodoData.self, from: Data(contentsOf: url))
                guard decoded.schemaVersion == 1 else { throw CocoaError(.fileReadCorruptFile) }
                data = decoded
            }
        } catch {
            errorMessage = "Saved tasks could not be opened: \(error.localizedDescription)"
        }
        Task { await reconcileNotifications() }
    }

    var activeTasks: [TodoTask] {
        data.tasks.filter { $0.deletedAt == nil && $0.completedAt == nil }
            .sorted { $0.sortKey == $1.sortKey ? $0.id.uuidString < $1.id.uuidString : $0.sortKey < $1.sortKey }
    }
    var projects: [TodoProject] { data.projects.filter { $0.deletedAt == nil && $0.archivedAt == nil } }

    func save(_ task: TodoTask) {
        guard errorMessage == nil else { return }
        var updated = task
        guard !updated.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        updated.title = updated.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if let index = data.tasks.firstIndex(where: { $0.id == task.id }) {
            updated.createdAt = data.tasks[index].createdAt
            updated.revision = data.tasks[index].revision + 1
            updated.updatedAt = Date()
            data.tasks[index] = updated
        } else {
            data.tasks.append(updated)
        }
        persist()
    }

    func quickAdd(_ title: String, projectID: UUID? = nil) {
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        save(TodoTask(title: clean, projectID: projectID))
    }

    func complete(_ id: UUID) {
        guard errorMessage == nil else { return }
        guard let index = data.tasks.firstIndex(where: { $0.id == id && $0.deletedAt == nil }) else { return }
        let now = Date()
        if data.tasks[index].completedAt != nil {
            data.tasks[index].completedAt = nil
            if let completionIndex = data.completions.lastIndex(where: { $0.taskID == id }) {
                data.completions.remove(at: completionIndex)
            }
        } else {
            let occurrence = data.tasks[index].dueDay
            data.completions.append(TodoCompletion(taskID: id, occurrenceDay: occurrence, completedAt: now))
            if let next = DayMath.next(data.tasks[index], after: occurrence ?? DayMath.day(now)) {
                data.tasks[index].dueDay = next
                data.tasks[index].occurrenceCount += 1
                data.tasks[index].scheduledStart = nil
                data.tasks[index].scheduledEnd = nil
            } else {
                data.tasks[index].completedAt = now
            }
        }
        data.tasks[index].updatedAt = now
        data.tasks[index].revision += 1
        persist()
    }

    func delete(_ id: UUID) {
        guard errorMessage == nil else { return }
        guard let index = data.tasks.firstIndex(where: { $0.id == id }) else { return }
        data.tasks[index].deletedAt = Date()
        data.tasks[index].revision += 1
        persist()
    }

    func addProject(_ name: String) {
        guard errorMessage == nil else { return }
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        data.projects.append(TodoProject(name: clean))
        persist()
    }

    func archive(_ id: UUID) {
        guard errorMessage == nil else { return }
        guard let index = data.projects.firstIndex(where: { $0.id == id }) else { return }
        data.projects[index].archivedAt = Date()
        data.projects[index].revision += 1
        persist()
    }

    private func persist() {
        guard errorMessage == nil else { return }
        do {
            try JSONEncoder().encode(data).write(to: url, options: .atomic)
            Task { await reconcileNotifications() }
        } catch {
            errorMessage = "Changes could not be saved: \(error.localizedDescription)"
        }
    }

    private func reconcileNotifications() async {
        let center = UNUserNotificationCenter.current()
        let existing = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: existing.filter { $0.identifier.hasPrefix("ltm-task-") }.map(\.identifier))
        let reminders = activeTasks.filter { $0.reminderMinutes != nil && $0.dueDay != nil && $0.dueTime != nil }
            .sorted { ($0.dueDay ?? "") + ($0.dueTime ?? "") < ($1.dueDay ?? "") + ($1.dueTime ?? "") }
        guard !reminders.isEmpty else { return }
        let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        guard granted else { return }
        for task in reminders.prefix(60) {
            guard let day = task.dueDay, let dueTime = task.dueTime,
                  let date = DayMath.date(day),
                  let hour = Int(dueTime.prefix(2)), let minute = Int(dueTime.suffix(2)),
                  let due = Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: date),
                  let triggerDate = Calendar.current.date(byAdding: .minute, value: -(task.reminderMinutes ?? 0), to: due),
                  triggerDate > Date() else { continue }
            let content = UNMutableNotificationContent()
            content.title = task.title
            content.body = "Task reminder"
            content.sound = .default
            let trigger = UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: triggerDate), repeats: false)
            try? await center.add(UNNotificationRequest(identifier: "ltm-task-\(task.id)", content: content, trigger: trigger))
        }
    }
}
