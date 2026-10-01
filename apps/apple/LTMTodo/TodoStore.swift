import Foundation
import Combine
import UserNotifications

@MainActor
final class TodoStore: ObservableObject {
    @Published private(set) var data = TodoData()
    @Published private(set) var errorMessage: String?
    @Published private(set) var localToday = DayMath.day(Date())
    private let url: URL
    private var savedData = TodoData()
    private var notificationWork: Task<Void, Never>?
    private var notificationGeneration = 0

    init() {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let isUITesting = ProcessInfo.processInfo.arguments.contains("--uitesting")
        url = folder.appendingPathComponent(isUITesting ? "LTM-Todo-uitesting.json" : "LTM-Todo-v1.json")
        var needsMigration = false
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            if isUITesting { try? FileManager.default.removeItem(at: url) }
            if FileManager.default.fileExists(atPath: url.path) {
                let bytes = try Data(contentsOf: url)
                let sourceVersion = (try? JSONSerialization.jsonObject(with: bytes) as? [String: Any])?["schemaVersion"] as? Int ?? 1
                needsMigration = sourceVersion < 2
                let decoded = try TodoDataFile.decode(bytes)
                data = decoded
                savedData = decoded
            }
        } catch {
            errorMessage = "Saved tasks could not be opened: \(error.localizedDescription)"
        }
        if errorMessage == nil && (pruneExpiredHistory() || needsMigration) { persist() }
        refreshNotifications()
    }

    var unarchivedTasks: [TodoTask] {
        let archived = Set(data.projects.filter { $0.archivedAt != nil && $0.deletedAt == nil }.map(\.id))
        return data.tasks.filter { $0.deletedAt == nil &&
            ($0.projectID.map { !archived.contains($0) } ?? true) }
            .sorted { $0.sortKey == $1.sortKey ? $0.id.uuidString < $1.id.uuidString : $0.sortKey < $1.sortKey }
    }
    var activeTasks: [TodoTask] { unarchivedTasks.filter { $0.completedAt == nil } }
    var projects: [TodoProject] {
        data.projects.filter { $0.deletedAt == nil && $0.archivedAt == nil }
            .sorted { $0.sortKey == $1.sortKey ? $0.id.uuidString < $1.id.uuidString : $0.sortKey < $1.sortKey }
    }
    var backupURL: URL? { FileManager.default.fileExists(atPath: url.path) ? url : nil }
    var visibleCalendars: [TodoCalendar] {
        data.calendars.filter { $0.deletedAt == nil }.sorted { $0.sortKey < $1.sortKey }
    }

    func addCalendar(name: String, color: TodoCalendarColor) {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard errorMessage == nil, !clean.isEmpty else { return }
        data.calendars.append(TodoCalendar(name: clean, color: color))
        persist()
    }

    func setCalendarVisible(_ id: UUID, visible: Bool) {
        guard let index = data.calendars.firstIndex(where: { $0.id == id && $0.deletedAt == nil }) else { return }
        data.calendars[index].visible = visible
        data.calendars[index].updatedAt = Date()
        data.calendars[index].revision += 1
        persist()
    }

    func save(_ event: TodoCalendarEvent) {
        guard errorMessage == nil,
              data.calendars.contains(where: { $0.id == event.calendarID && $0.deletedAt == nil }),
              !event.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        var updated = event
        updated.title = updated.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard updated.allDay ? (updated.startDay != nil && updated.endDay != nil && updated.endDay! > updated.startDay!) :
            (updated.startInstant != nil && updated.endInstant != nil && updated.endInstant! > updated.startInstant! && TimeZone(identifier: updated.timeZoneID ?? "") != nil) else { return }
        if let index = data.calendarEvents.firstIndex(where: { $0.id == event.id }) {
            updated.createdAt = data.calendarEvents[index].createdAt
            updated.revision = data.calendarEvents[index].revision + 1
            updated.updatedAt = Date()
            data.calendarEvents[index] = updated
        } else { data.calendarEvents.append(updated) }
        persist()
    }

    func deleteCalendarEvent(_ id: UUID) {
        guard let index = data.calendarEvents.firstIndex(where: { $0.id == id && $0.deletedAt == nil }) else { return }
        data.calendarEvents[index].deletedAt = Date()
        data.calendarEvents[index].updatedAt = Date()
        data.calendarEvents[index].revision += 1
        persist()
    }

    func calendarEvents(on day: String) -> [TodoCalendarEvent] {
        let visible = Set(visibleCalendars.filter(\.visible).map(\.id))
        return data.calendarEvents.filter { event in
            guard event.deletedAt == nil, visible.contains(event.calendarID) else { return false }
            let zone = TimeZone(identifier: event.timeZoneID ?? "") ?? .current
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = zone
            let baseDay = event.startDay ?? event.startInstant.map { DayMath.day($0, calendar: calendar) } ?? ""
            guard !baseDay.isEmpty, let baseDate = DayMath.date(baseDay, calendar: calendar), let target = DayMath.date(day, calendar: calendar) else { return false }
            let eventStart = event.startInstant ?? baseDate
            let eventEnd = event.endInstant ?? eventStart.addingTimeInterval(3600)
            let duration = event.allDay
                ? max(1, calendar.dateComponents([.day], from: baseDate, to: DayMath.date(event.endDay ?? baseDay, calendar: calendar) ?? baseDate).day ?? 1)
                : max(1, (calendar.dateComponents([.day], from: calendar.startOfDay(for: eventStart), to: calendar.startOfDay(for: eventEnd.addingTimeInterval(-1))).day ?? 0) + 1)
            let possibleStarts = (0..<duration).compactMap { DayMath.add(-$0, to: day, calendar: calendar) }
            guard let occurrenceDay = possibleStarts.first(where: { eventRecurs(event, anchor: baseDay, on: $0, calendar: calendar) }) else { return false }
            return event.allDay ? occurrenceDay <= day && (DayMath.add(duration, to: occurrenceDay, calendar: calendar) ?? occurrenceDay) > day : {
                    guard let start = event.startInstant, let end = event.endInstant else { return false }
                    let targetStart = calendar.startOfDay(for: target)
                    let targetEnd = calendar.date(byAdding: .day, value: 1, to: targetStart) ?? targetStart.addingTimeInterval(86400)
                    let elapsed = calendar.dateComponents([.day], from: baseDate, to: DayMath.date(occurrenceDay, calendar: calendar) ?? baseDate).day ?? 0
                    let occurrenceStart = calendar.date(byAdding: .day, value: elapsed, to: start) ?? start
                    let occurrenceEnd = occurrenceStart.addingTimeInterval(end.timeIntervalSince(start))
                    return occurrenceStart < targetEnd && occurrenceEnd > targetStart
                }())
        }.sorted { ($0.allDay ? Date.distantPast : $0.startInstant ?? .distantFuture) < ($1.allDay ? Date.distantPast : $1.startInstant ?? .distantFuture) }
    }

    private func eventRecurs(_ event: TodoCalendarEvent, anchor: String, on day: String, calendar: Calendar) -> Bool {
        guard day >= anchor else { return false }
        guard let rule = event.recurrence else { return day == anchor }
        if let until = rule.until, day > until { return false }
        let interval = max(1, rule.interval)
        guard let anchorDate = DayMath.date(anchor, calendar: calendar), let date = DayMath.date(day, calendar: calendar) else { return false }
        switch rule.frequency {
        case .never: return day == anchor
        case .daily:
            let n = calendar.dateComponents([.day], from: anchorDate, to: date).day ?? -1
            return n >= 0 && n % interval == 0 && (rule.count.map { n / interval < $0 } ?? true)
        case .weekly:
            let days = rule.weekdays ?? [calendar.component(.weekday, from: anchorDate) - 1]
            let weeks = (calendar.dateComponents([.weekOfYear], from: anchorDate, to: date).weekOfYear ?? -1)
            let prior = max(0, calendar.dateComponents([.day], from: anchorDate, to: date).day ?? 0)
            return weeks >= 0 && weeks % interval == 0 && days.contains(calendar.component(.weekday, from: date) - 1) && (rule.count.map { prior / interval < $0 } ?? true)
        case .monthly, .yearly:
            let components = calendar.dateComponents([.year, .month], from: anchorDate)
            let target = calendar.dateComponents([.year, .month], from: date)
            let months = (target.year! - components.year!) * 12 + target.month! - components.month!
            let step = interval * (rule.frequency == .yearly ? 12 : 1)
            guard months >= 0 && months % step == 0 else { return false }
            let anchorDay = calendar.component(.day, from: anchorDate)
            let monthStart = calendar.date(from: DateComponents(year: target.year, month: target.month, day: 1))!
            let last = calendar.range(of: .day, in: .month, for: monthStart)!.count
            let expected = calendar.date(byAdding: .day, value: min(anchorDay, last) - 1, to: monthStart)!
            return calendar.isDate(expected, inSameDayAs: date) && (rule.count.map { months / step < $0 } ?? true)
        }
    }

    func save(_ task: TodoTask) {
        guard errorMessage == nil else { return }
        var updated = task
        guard !updated.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        if let dueDay = updated.dueDay, dueDay < DashboardRetention.earliestDay() { return }
        if let parentID = updated.parentTaskID {
            guard parentID != updated.id,
                  let parent = data.tasks.first(where: { $0.id == parentID && $0.deletedAt == nil }),
                  parent.parentTaskID == nil,
                  parent.projectID == updated.projectID,
                  !data.tasks.contains(where: { $0.parentTaskID == updated.id }) else { return }
        }
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

    func moveTask(_ id: UUID, by direction: Int) {
        guard errorMessage == nil,
              let task = data.tasks.first(where: { $0.id == id && $0.deletedAt == nil }) else { return }
        var group = data.tasks.filter {
            $0.deletedAt == nil && $0.projectID == task.projectID &&
            $0.sectionID == task.sectionID && $0.parentTaskID == task.parentTaskID
        }.sorted {
            $0.sortKey == $1.sortKey ? $0.id.uuidString < $1.id.uuidString : $0.sortKey < $1.sortKey
        }
        guard let from = group.firstIndex(where: { $0.id == id }) else { return }
        let to = from + direction
        guard group.indices.contains(to) else { return }
        group.insert(group.remove(at: from), at: to)

        let before = to > 0 ? group[to - 1].sortKey : nil
        let after = to + 1 < group.count ? group[to + 1].sortKey : nil
        let key = before.map { left in after.map { right in (left + right) / 2 } ?? left + 1024 } ?? ((after ?? 0) - 1024)
        let now = Date()
        if key.isFinite && (before.map { key != $0 } ?? true) && (after.map { key != $0 } ?? true),
           let index = data.tasks.firstIndex(where: { $0.id == id }) {
            data.tasks[index].sortKey = key
            data.tasks[index].updatedAt = now
            data.tasks[index].revision += 1
        } else {
            for (position, item) in group.enumerated() {
                guard let index = data.tasks.firstIndex(where: { $0.id == item.id }) else { continue }
                let key = Double(position * 1024)
                if data.tasks[index].sortKey != key {
                    data.tasks[index].sortKey = key
                    data.tasks[index].updatedAt = now
                    data.tasks[index].revision += 1
                }
            }
        }
        persist()
    }

    func complete(_ id: UUID) {
        guard errorMessage == nil else { return }
        guard let index = data.tasks.firstIndex(where: { $0.id == id && $0.deletedAt == nil }) else { return }
        guard data.tasks[index].completedAt != nil || !data.tasks.contains(where: { $0.parentTaskID == id && $0.completedAt == nil && $0.deletedAt == nil }) else { return }
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
        data.projects[index].updatedAt = Date()
        data.projects[index].revision += 1
        persist()
    }

    func restoreProject(_ id: UUID) {
        guard let index = data.projects.firstIndex(where: { $0.id == id }) else { return }
        data.projects[index].archivedAt = nil
        data.projects[index].updatedAt = Date()
        data.projects[index].revision += 1
        persist()
    }

    func moveProject(_ id: UUID, by direction: Int) {
        guard errorMessage == nil else { return }
        var ordered = projects
        guard let from = ordered.firstIndex(where: { $0.id == id }), ordered.indices.contains(from + direction) else { return }
        let to = from + direction
        ordered.insert(ordered.remove(at: from), at: to)
        let now = Date()
        let before = to > 0 ? ordered[to - 1].sortKey : nil
        let after = to + 1 < ordered.count ? ordered[to + 1].sortKey : nil
        let key = before.map { left in after.map { right in (left + right) / 2 } ?? (left + 1024) } ?? ((after ?? 0) - 1024)
        if key.isFinite && (before.map { key != $0 } ?? true) && (after.map { key != $0 } ?? true),
           let index = data.projects.firstIndex(where: { $0.id == id }) {
            data.projects[index].sortKey = key
            data.projects[index].updatedAt = now
            data.projects[index].revision += 1
            persist()
            return
        }
        for (position, project) in ordered.enumerated() {
            guard let index = data.projects.firstIndex(where: { $0.id == project.id }) else { continue }
            let key = Double(position * 1024)
            if data.projects[index].sortKey != key {
                data.projects[index].sortKey = key
                data.projects[index].updatedAt = now
                data.projects[index].revision += 1
            }
        }
        persist()
    }

    func moveSection(_ id: UUID, by direction: Int) {
        guard errorMessage == nil, let section = data.sections.first(where: { $0.id == id && $0.deletedAt == nil }) else { return }
        var ordered = data.sections.filter { $0.projectID == section.projectID && $0.deletedAt == nil }
            .sorted { $0.sortKey == $1.sortKey ? $0.id.uuidString < $1.id.uuidString : $0.sortKey < $1.sortKey }
        guard let from = ordered.firstIndex(where: { $0.id == id }), ordered.indices.contains(from + direction) else { return }
        let to = from + direction
        ordered.insert(ordered.remove(at: from), at: to)
        let now = Date()
        let before = to > 0 ? ordered[to - 1].sortKey : nil
        let after = to + 1 < ordered.count ? ordered[to + 1].sortKey : nil
        let key = before.map { left in after.map { right in (left + right) / 2 } ?? (left + 1024) } ?? ((after ?? 0) - 1024)
        if key.isFinite && (before.map { key != $0 } ?? true) && (after.map { key != $0 } ?? true),
           let index = data.sections.firstIndex(where: { $0.id == id }) {
            data.sections[index].sortKey = key
            data.sections[index].updatedAt = now
            data.sections[index].revision += 1
            persist()
            return
        }
        for (position, item) in ordered.enumerated() {
            guard let index = data.sections.firstIndex(where: { $0.id == item.id }) else { continue }
            let key = Double(position * 1024)
            if data.sections[index].sortKey != key {
                data.sections[index].sortKey = key
                data.sections[index].updatedAt = now
                data.sections[index].revision += 1
            }
        }
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
        data.sections[index].updatedAt = Date()
        data.sections[index].revision += 1
        for taskIndex in data.tasks.indices where data.tasks[taskIndex].sectionID == id {
            data.tasks[taskIndex].sectionID = nil
            data.tasks[taskIndex].updatedAt = Date()
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
        _ = pruneExpiredHistory()
        do {
            try JSONEncoder().encode(data).write(to: url, options: .atomic)
            savedData = data
            refreshNotifications()
        } catch {
            data = savedData
            errorMessage = "Changes could not be saved: \(error.localizedDescription)"
        }
    }

    func expireOldHistory() {
        guard errorMessage == nil else { return }
        let today = DayMath.day(Date())
        let dayChanged = localToday != today
        if dayChanged { localToday = today }
        if pruneExpiredHistory(today: today) { persist() }
        else if dayChanged { refreshNotifications() }
    }

    @discardableResult
    private func pruneExpiredHistory(today: String = DayMath.day(Date())) -> Bool {
        let cutoff = DashboardRetention.earliestDay(today: today)
        let expiredTaskIDs = Set(data.tasks.filter { task in
            if let dueDay = task.dueDay, dueDay < cutoff { return true }
            if let deletedAt = task.deletedAt, DayMath.day(deletedAt) < cutoff { return true }
            if task.dueDay == nil, let completedAt = task.completedAt {
                return DayMath.day(completedAt) < cutoff
            }
            return false
        }.map(\.id))
        var changed = !expiredTaskIDs.isEmpty
        let now = Date()
        if !expiredTaskIDs.isEmpty {
            data.tasks.removeAll { expiredTaskIDs.contains($0.id) }
            for index in data.tasks.indices where data.tasks[index].parentTaskID.map(expiredTaskIDs.contains) == true {
                data.tasks[index].parentTaskID = nil
                data.tasks[index].updatedAt = now
                data.tasks[index].revision += 1
                changed = true
            }
        }
        for index in data.tasks.indices {
            if let start = data.tasks[index].scheduledStart, DayMath.day(start) < cutoff {
                data.tasks[index].scheduledStart = nil
                data.tasks[index].scheduledEnd = nil
                data.tasks[index].updatedAt = now
                data.tasks[index].revision += 1
                changed = true
            }
        }
        let oldCompletionCount = data.completions.count
        data.completions.removeAll { completion in
            if expiredTaskIDs.contains(completion.taskID) { return true }
            let historyDay = completion.occurrenceDay ?? DayMath.day(completion.completedAt)
            return historyDay < cutoff
        }
        if data.completions.count != oldCompletionCount { changed = true }
        for index in data.completions.indices {
            if let start = data.completions[index].scheduledStart, DayMath.day(start) < cutoff {
                data.completions[index].scheduledStart = nil
                data.completions[index].scheduledEnd = nil
                changed = true
            }
        }
        return changed
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
            content.title = "LTM Todo reminder"
            content.body = task.title
            content.sound = .default
            let trigger = UNCalendarNotificationTrigger(dateMatching: calendar.dateComponents([.year, .month, .day, .hour, .minute], from: triggerDate), repeats: false)
            try? await center.add(UNNotificationRequest(identifier: "ltm-task-\(task.id)", content: content, trigger: trigger))
        }
    }
}
