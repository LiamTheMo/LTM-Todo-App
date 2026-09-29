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
        let interval = max(task.interval, 1)
        for index in 1...2400 {
            let candidate: String?
            switch task.frequency {
            case .never: return nil
            case .daily: candidate = add(index * interval, to: anchor, calendar: calendar)
            case .weekly: candidate = add(index * interval, to: anchor, component: .weekOfYear, calendar: calendar)
            case .monthly: candidate = add(index * interval, to: anchor, component: .month, calendar: calendar)
            case .yearly: candidate = add(index * interval, to: anchor, component: .year, calendar: calendar)
            }
            if let candidate, candidate > current { return candidate }
        }
        return nil
    }
}
