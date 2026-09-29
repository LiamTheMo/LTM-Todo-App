import Foundation
import Combine
import UserNotifications

@MainActor
final class TodoStore: ObservableObject {
    @Published private(set) var data = TodoData()
    @Published private(set) var errorMessage: String?
    private let url: URL
    private var notificationWork: Task<Void, Never>?
    private var notificationGeneration = 0

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
        refreshNotifications()
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
            let moved = data.tasks[index].projectID != updated.projectID || data.tasks[index].sectionID != updated.sectionID
            updated.createdAt = data.tasks[index].createdAt
            updated.revision = data.tasks[index].revision + 1
            updated.updatedAt = Date()
            data.tasks[index] = updated
            if moved {
                for childIndex in data.tasks.indices where data.tasks[childIndex].parentTaskID == updated.id {
                    data.tasks[childIndex].projectID = updated.projectID
                    data.tasks[childIndex].sectionID = updated.sectionID
                    data.tasks[childIndex].revision += 1
                    data.tasks[childIndex].updatedAt = Date()
                }
            }
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
        guard !data.tasks.contains(where: { $0.parentTaskID == id && $0.completedAt == nil && $0.deletedAt == nil }) else { return }
        guard let index = data.tasks.firstIndex(where: { $0.id == id && $0.deletedAt == nil }) else { return }
        let now = Date()
        if data.tasks[index].completedAt != nil {
            data.tasks[index].completedAt = nil
            if let completionIndex = data.completions.lastIndex(where: { $0.taskID == id }) {
                data.completions.remove(at: completionIndex)
            }
        } else {
            let occurrence = data.tasks[index].dueDay
            data.completions.append(TodoCompletion(taskID: id, occurrenceDay: occurrence, completedAt: now,
                scheduledStart: data.tasks[index].scheduledStart, scheduledEnd: data.tasks[index].scheduledEnd))
            if data.tasks[index].frequency != .never { data.tasks[index].occurrenceCount += 1 }
            if let next = DayMath.next(data.tasks[index], after: occurrence ?? DayMath.day(now)) {
                data.tasks[index].dueDay = next
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

    func undoCompletion(_ completionID: UUID) {
        guard let completionIndex = data.completions.firstIndex(where: { $0.id == completionID }) else { return }
        let completion = data.completions[completionIndex]
        guard data.completions.last(where: { $0.taskID == completion.taskID })?.id == completionID,
              let taskIndex = data.tasks.firstIndex(where: { $0.id == completion.taskID }) else { return }
        data.tasks[taskIndex].dueDay = completion.occurrenceDay
        data.tasks[taskIndex].scheduledStart = completion.scheduledStart
        data.tasks[taskIndex].scheduledEnd = completion.scheduledEnd
        data.tasks[taskIndex].completedAt = nil
        data.tasks[taskIndex].occurrenceCount = max(0, data.tasks[taskIndex].occurrenceCount - 1)
        data.tasks[taskIndex].revision += 1
        data.tasks[taskIndex].updatedAt = Date()
        data.completions.remove(at: completionIndex)
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

    func restoreProject(_ id: UUID) {
        guard let index = data.projects.firstIndex(where: { $0.id == id }) else { return }
        data.projects[index].archivedAt = nil
        data.projects[index].revision += 1
        persist()
    }

    func addSection(_ name: String, to projectID: UUID) {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        data.sections.append(TodoSection(projectID: projectID, name: clean))
        persist()
    }

    func deleteSection(_ id: UUID) {
        guard let index = data.sections.firstIndex(where: { $0.id == id }) else { return }
        data.sections[index].deletedAt = Date()
        data.sections[index].revision += 1
        for taskIndex in data.tasks.indices where data.tasks[taskIndex].sectionID == id {
            data.tasks[taskIndex].sectionID = nil
            data.tasks[taskIndex].revision += 1
        }
        persist()
    }

    func addTag(_ name: String) {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        data.tags.append(TodoTag(name: clean))
        persist()
    }

    func renameTag(_ id: UUID, to name: String) {
        guard let index = data.tags.firstIndex(where: { $0.id == id }) else { return }
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        data.tags[index].name = clean
        data.tags[index].updatedAt = Date()
        data.tags[index].revision += 1
        persist()
    }

    func deleteTag(_ id: UUID) {
        guard let index = data.tags.firstIndex(where: { $0.id == id }) else { return }
        data.tags[index].deletedAt = Date()
        data.tags[index].revision += 1
        for taskIndex in data.tasks.indices where data.tasks[taskIndex].tagIDs.contains(id) {
            data.tasks[taskIndex].tagIDs.removeAll { $0 == id }
            data.tasks[taskIndex].revision += 1
        }
        persist()
    }

    private func persist() {
        guard errorMessage == nil else { return }
        do {
            try JSONEncoder().encode(data).write(to: url, options: .atomic)
            refreshNotifications()
        } catch {
            errorMessage = "Changes could not be saved: \(error.localizedDescription)"
        }
    }

    func refreshNotifications() {
        notificationGeneration += 1
        let generation = notificationGeneration
        let previous = notificationWork
        notificationWork = Task { [weak self] in
            if let previous { await previous.value }
            guard let self, generation == self.notificationGeneration else { return }
            await self.reconcileNotifications()
        }
    }

    private func reconcileNotifications() async {
        let center = UNUserNotificationCenter.current()
        let existing = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: existing.filter { $0.identifier.hasPrefix("ltm-task-") }.map(\.identifier))
        let calendar = Calendar.current
        let now = Date()
        let reminders: [(task: TodoTask, triggerDate: Date)] = activeTasks.compactMap { task in
            guard let day = task.dueDay, let dueTime = task.dueTime,
                  let date = DayMath.date(day),
                  let hour = Int(dueTime.prefix(2)), let minute = Int(dueTime.suffix(2)),
                  let minutes = task.reminderMinutes, (0...525600).contains(minutes),
                  (0...23).contains(hour), (0...59).contains(minute) else { return nil }
            var components = calendar.dateComponents([.year, .month, .day], from: date)
            components.hour = hour
            components.minute = minute
            // Spring gaps move forward preserving minutes; fall overlaps use the first instance.
            guard let due = calendar.nextDate(after: calendar.startOfDay(for: date).addingTimeInterval(-1),
                matching: components, matchingPolicy: .nextTimePreservingSmallerComponents,
                repeatedTimePolicy: .first, direction: .forward) else { return nil }
            let triggerDate = due.addingTimeInterval(TimeInterval(-60 * minutes))
            return triggerDate > now ? (task, triggerDate) : nil
        }.sorted { $0.triggerDate < $1.triggerDate }
        guard !reminders.isEmpty else { return }
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .denied { return }
        if settings.authorizationStatus == .notDetermined {
            guard (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) == true else { return }
        }
        for (task, triggerDate) in reminders.prefix(60) {
            let content = UNMutableNotificationContent()
            content.title = task.title
            content.body = "Task reminder"
            content.sound = .default
            let trigger = UNCalendarNotificationTrigger(dateMatching: calendar.dateComponents([.year, .month, .day, .hour, .minute], from: triggerDate), repeats: false)
            try? await center.add(UNNotificationRequest(identifier: "ltm-task-\(task.id)", content: content, trigger: trigger))
        }
    }
}
