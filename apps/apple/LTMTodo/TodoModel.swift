import Foundation

struct TodoTask: Codable, Identifiable {
    var id = UUID()
    var title: String
    var notes = ""
    var priority = 0
    var projectID: UUID?
    var sectionID: UUID?
    var parentTaskID: UUID?
    var tagIDs: [UUID] = []
    var dueDay: String?
    var dueTime: String?
    var scheduledStart: Date?
    var scheduledEnd: Date?
    var frequency: RepeatFrequency = .never
    var interval = 1
    var repeatAnchor: String?
    var occurrenceCount = 0
    var repeatWeekdays: [Int]?
    var repeatUntil: String?
    var repeatCount: Int?
    var reminderMinutes: Int?
    var completedAt: Date?
    var createdAt = Date()
    var updatedAt = Date()
    var revision = 1
    var deletedAt: Date?
    var sortKey = Date().timeIntervalSince1970
}

enum RepeatFrequency: String, Codable, CaseIterable, Identifiable {
    case never, daily, weekly, monthly, yearly
    var id: Self { self }
}

struct TodoProject: Codable, Identifiable {
    var id = UUID()
    var name: String
    var archivedAt: Date?
    var deletedAt: Date?
    var createdAt = Date()
    var updatedAt = Date()
    var revision = 1
    var sortKey = Date().timeIntervalSince1970
}

struct TodoTag: Codable, Identifiable {
    var id = UUID()
    var name: String
    var deletedAt: Date?
    var createdAt = Date()
    var updatedAt = Date()
    var revision = 1
}

struct TodoSection: Codable, Identifiable {
    var id = UUID()
    var projectID: UUID
    var name: String
    var sortKey = Date().timeIntervalSince1970
    var deletedAt: Date?
    var createdAt = Date()
    var updatedAt = Date()
    var revision = 1
}

struct TodoCompletion: Codable, Identifiable {
    var id = UUID()
    var taskID: UUID
    var occurrenceDay: String?
    var completedAt: Date
    var scheduledStart: Date?
    var scheduledEnd: Date?
}

struct TodoData: Codable {
    var schemaVersion = 1
    var tasks: [TodoTask] = []
    var projects: [TodoProject] = []
    var tags: [TodoTag] = []
    var sections: [TodoSection] = []
    var completions: [TodoCompletion] = []

    enum CodingKeys: String, CodingKey { case schemaVersion, tasks, projects, tags, sections, completions }
    init() {}
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try values.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        tasks = try values.decodeIfPresent([TodoTask].self, forKey: .tasks) ?? []
        projects = try values.decodeIfPresent([TodoProject].self, forKey: .projects) ?? []
        tags = try values.decodeIfPresent([TodoTag].self, forKey: .tags) ?? []
        sections = try values.decodeIfPresent([TodoSection].self, forKey: .sections) ?? []
        completions = try values.decodeIfPresent([TodoCompletion].self, forKey: .completions) ?? []
    }
}

enum DayMath {
    static func day(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    static func date(_ value: String, calendar: Calendar = .current) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    static func add(_ amount: Int, to value: String, component: Calendar.Component = .day, calendar: Calendar = .current) -> String? {
        guard let date = date(value, calendar: calendar),
              let result = calendar.date(byAdding: component, value: amount, to: date) else { return nil }
        return day(result, calendar: calendar)
    }

    static func next(_ task: TodoTask, after current: String, calendar: Calendar = .current) -> String? {
        guard let anchor = task.repeatAnchor, task.frequency != .never else { return nil }
        if let count = task.repeatCount, task.occurrenceCount >= count { return nil }
        let interval = max(task.interval, 1)
        guard let anchorDate = date(anchor, calendar: calendar), let currentDate = date(current, calendar: calendar) else { return nil }
        let candidate: String?
        switch task.frequency {
        case .never: return nil
        case .daily:
            let days = calendar.dateComponents([.day], from: anchorDate, to: currentDate).day ?? 0
            candidate = add(max(1, days / interval + 1) * interval, to: anchor, calendar: calendar)
        case .weekly:
            let anchorWeekday = (calendar.component(.weekday, from: anchorDate) + 6) % 7
            let weekdays = task.repeatWeekdays?.isEmpty == false ? task.repeatWeekdays! : [anchorWeekday]
            let start = max(anchor, current)
            for offset in 1...(interval * 7 + 7) {
                guard let day = add(offset, to: start, calendar: calendar), let dayDate = date(day, calendar: calendar) else { continue }
                let days = calendar.dateComponents([.day], from: anchorDate, to: dayDate).day ?? 0
                let week = (days + anchorWeekday) / 7
                if week % interval == 0 && weekdays.contains((calendar.component(.weekday, from: dayDate) + 6) % 7) {
                    return (task.repeatUntil.map { day <= $0 } ?? true) ? day : nil
                }
            }
            return nil
        case .monthly, .yearly:
            let start = calendar.dateComponents([.year, .month], from: anchorDate)
            let end = calendar.dateComponents([.year, .month], from: currentDate)
            let monthStep = interval * (task.frequency == .yearly ? 12 : 1)
            var index = max(1, (((end.year ?? 0) - (start.year ?? 0)) * 12 + (end.month ?? 0) - (start.month ?? 0)) / monthStep)
            var next = anchoredMonth(anchor, months: index * monthStep, calendar: calendar)
            if let nextDay = next, nextDay <= current {
                index += 1
                next = anchoredMonth(anchor, months: index * monthStep, calendar: calendar)
            }
            candidate = next
        }
        guard let candidate else { return nil }
        return (task.repeatUntil.map { candidate <= $0 } ?? true) ? candidate : nil
    }

    private static func anchoredMonth(_ anchor: String, months: Int, calendar: Calendar) -> String? {
        guard let anchorDate = date(anchor, calendar: calendar),
              let first = calendar.date(from: DateComponents(year: calendar.component(.year, from: anchorDate),
                  month: calendar.component(.month, from: anchorDate), day: 1, hour: 12)),
              let target = calendar.date(byAdding: .month, value: months, to: first),
              let range = calendar.range(of: .day, in: .month, for: target),
              let result = calendar.date(byAdding: .day, value: min(calendar.component(.day, from: anchorDate), range.count) - 1, to: target)
        else { return nil }
        return day(result, calendar: calendar)
    }
}
