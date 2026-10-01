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

extension TodoTask {
    enum CodingKeys: String, CodingKey {
        case id, title, notes, priority, projectID, sectionID, parentTaskID, tagIDs, dueDay, dueTime
        case scheduledStart, scheduledEnd, frequency, interval, repeatAnchor, occurrenceCount
        case repeatWeekdays, repeatUntil, repeatCount, reminderMinutes, completedAt, createdAt
        case updatedAt, revision, deletedAt, sortKey
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        title = try values.decode(String.self, forKey: .title)
        notes = try values.decodeIfPresent(String.self, forKey: .notes) ?? ""
        priority = try values.decodeIfPresent(Int.self, forKey: .priority) ?? 0
        projectID = try values.decodeIfPresent(UUID.self, forKey: .projectID)
        sectionID = try values.decodeIfPresent(UUID.self, forKey: .sectionID)
        parentTaskID = try values.decodeIfPresent(UUID.self, forKey: .parentTaskID)
        tagIDs = try values.decodeIfPresent([UUID].self, forKey: .tagIDs) ?? []
        dueDay = try values.decodeIfPresent(String.self, forKey: .dueDay)
        dueTime = try values.decodeIfPresent(String.self, forKey: .dueTime)
        scheduledStart = try values.decodeIfPresent(Date.self, forKey: .scheduledStart)
        scheduledEnd = try values.decodeIfPresent(Date.self, forKey: .scheduledEnd)
        frequency = try values.decodeIfPresent(RepeatFrequency.self, forKey: .frequency) ?? .never
        interval = try values.decodeIfPresent(Int.self, forKey: .interval) ?? 1
        repeatAnchor = try values.decodeIfPresent(String.self, forKey: .repeatAnchor)
        occurrenceCount = try values.decodeIfPresent(Int.self, forKey: .occurrenceCount) ?? 0
        repeatWeekdays = try values.decodeIfPresent([Int].self, forKey: .repeatWeekdays)
        repeatUntil = try values.decodeIfPresent(String.self, forKey: .repeatUntil)
        repeatCount = try values.decodeIfPresent(Int.self, forKey: .repeatCount)
        reminderMinutes = try values.decodeIfPresent(Int.self, forKey: .reminderMinutes)
        completedAt = try values.decodeIfPresent(Date.self, forKey: .completedAt)
        createdAt = try values.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        updatedAt = try values.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
        revision = try values.decodeIfPresent(Int.self, forKey: .revision) ?? 1
        deletedAt = try values.decodeIfPresent(Date.self, forKey: .deletedAt)
        sortKey = try values.decodeIfPresent(Double.self, forKey: .sortKey) ?? createdAt.timeIntervalSince1970
    }
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

    init(id: UUID = UUID(), name: String, archivedAt: Date? = nil, deletedAt: Date? = nil,
         createdAt: Date = Date(), updatedAt: Date? = nil, revision: Int = 1, sortKey: Double? = nil) {
        self.id = id
        self.name = name
        self.archivedAt = archivedAt
        self.deletedAt = deletedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.revision = revision
        self.sortKey = sortKey ?? createdAt.timeIntervalSince1970
    }

    enum CodingKeys: String, CodingKey { case id, name, archivedAt, deletedAt, createdAt, updatedAt, revision, sortKey }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        archivedAt = try values.decodeIfPresent(Date.self, forKey: .archivedAt)
        deletedAt = try values.decodeIfPresent(Date.self, forKey: .deletedAt)
        createdAt = try values.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        updatedAt = try values.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
        revision = try values.decodeIfPresent(Int.self, forKey: .revision) ?? 1
        sortKey = try values.decodeIfPresent(Double.self, forKey: .sortKey) ?? createdAt.timeIntervalSince1970
    }
}

struct TodoTag: Codable, Identifiable {
    var id = UUID()
    var name: String
    var deletedAt: Date?
    var createdAt = Date()
    var updatedAt = Date()
    var revision = 1

    init(id: UUID = UUID(), name: String, deletedAt: Date? = nil, createdAt: Date = Date(),
         updatedAt: Date? = nil, revision: Int = 1) {
        self.id = id
        self.name = name
        self.deletedAt = deletedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.revision = revision
    }

    enum CodingKeys: String, CodingKey { case id, name, deletedAt, createdAt, updatedAt, revision }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        deletedAt = try values.decodeIfPresent(Date.self, forKey: .deletedAt)
        createdAt = try values.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        updatedAt = try values.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
        revision = try values.decodeIfPresent(Int.self, forKey: .revision) ?? 1
    }
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

    init(id: UUID = UUID(), projectID: UUID, name: String, sortKey: Double? = nil, deletedAt: Date? = nil,
         createdAt: Date = Date(), updatedAt: Date? = nil, revision: Int = 1) {
        self.id = id
        self.projectID = projectID
        self.name = name
        self.sortKey = sortKey ?? createdAt.timeIntervalSince1970
        self.deletedAt = deletedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.revision = revision
    }

    enum CodingKeys: String, CodingKey { case id, projectID, name, sortKey, deletedAt, createdAt, updatedAt, revision }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        projectID = try values.decode(UUID.self, forKey: .projectID)
        name = try values.decode(String.self, forKey: .name)
        sortKey = try values.decodeIfPresent(Double.self, forKey: .sortKey) ?? Date().timeIntervalSince1970
        deletedAt = try values.decodeIfPresent(Date.self, forKey: .deletedAt)
        createdAt = try values.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        updatedAt = try values.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
        revision = try values.decodeIfPresent(Int.self, forKey: .revision) ?? 1
    }
}

struct TodoCompletion: Codable, Identifiable {
    var id = UUID()
    var taskID: UUID
    var occurrenceDay: String?
    var completedAt: Date
    var scheduledStart: Date?
    var scheduledEnd: Date?

    init(id: UUID = UUID(), taskID: UUID, occurrenceDay: String? = nil, completedAt: Date,
         scheduledStart: Date? = nil, scheduledEnd: Date? = nil) {
        self.id = id
        self.taskID = taskID
        self.occurrenceDay = occurrenceDay
        self.completedAt = completedAt
        self.scheduledStart = scheduledStart
        self.scheduledEnd = scheduledEnd
    }

    enum CodingKeys: String, CodingKey { case id, taskID, occurrenceDay, completedAt, scheduledStart, scheduledEnd }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        taskID = try values.decode(UUID.self, forKey: .taskID)
        occurrenceDay = try values.decodeIfPresent(String.self, forKey: .occurrenceDay)
        completedAt = try values.decode(Date.self, forKey: .completedAt)
        scheduledStart = try values.decodeIfPresent(Date.self, forKey: .scheduledStart)
        scheduledEnd = try values.decodeIfPresent(Date.self, forKey: .scheduledEnd)
    }
}

enum TodoCalendarColor: String, Codable, CaseIterable, Identifiable {
    case orange, blue, green, purple, red, teal
    var id: Self { self }
}

struct TodoCalendar: Codable, Identifiable {
    var id = UUID()
    var name: String
    var color: TodoCalendarColor = .orange
    var visible = true
    var sortKey = Date().timeIntervalSince1970
    var createdAt = Date()
    var updatedAt = Date()
    var revision = 1
    var deletedAt: Date?
}

struct TodoEventRecurrence: Codable {
    var frequency: RepeatFrequency
    var interval = 1
    var weekdays: [Int]?
    var until: String?
    var count: Int?
}

struct TodoCalendarEvent: Codable, Identifiable {
    var id = UUID()
    var calendarID: UUID
    var title: String
    var notes = ""
    var allDay = false
    var startDay: String?
    var endDay: String? // Exclusive for all-day events.
    var startInstant: Date?
    var endInstant: Date?
    var timeZoneID: String?
    var recurrence: TodoEventRecurrence?
    var createdAt = Date()
    var updatedAt = Date()
    var revision = 1
    var deletedAt: Date?
}

struct TodoData: Codable {
    var schemaVersion = 2
    var tasks: [TodoTask] = []
    var projects: [TodoProject] = []
    var tags: [TodoTag] = []
    var sections: [TodoSection] = []
    var completions: [TodoCompletion] = []
    var calendars: [TodoCalendar] = [TodoData.personalCalendar()]
    var calendarEvents: [TodoCalendarEvent] = []

    enum CodingKeys: String, CodingKey { case schemaVersion, tasks, projects, tags, sections, completions, calendars, calendarEvents }
    init() {}
    static func personalCalendar() -> TodoCalendar {
        TodoCalendar(id: UUID(uuidString: "00000000-0000-4000-8000-000000000001")!, name: "Personal", color: .orange, visible: true, sortKey: 0)
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try values.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        tasks = try values.decodeIfPresent([TodoTask].self, forKey: .tasks) ?? []
        projects = try values.decodeIfPresent([TodoProject].self, forKey: .projects) ?? []
        tags = try values.decodeIfPresent([TodoTag].self, forKey: .tags) ?? []
        sections = try values.decodeIfPresent([TodoSection].self, forKey: .sections) ?? []
        completions = try values.decodeIfPresent([TodoCompletion].self, forKey: .completions) ?? []
        calendars = try values.decodeIfPresent([TodoCalendar].self, forKey: .calendars) ?? [Self.personalCalendar()]
        calendarEvents = try values.decodeIfPresent([TodoCalendarEvent].self, forKey: .calendarEvents) ?? []
    }
}

enum TodoDataFile {
    static func decode(_ data: Data) throws -> TodoData {
        let decoded = try JSONDecoder().decode(TodoData.self, from: data)
        guard decoded.schemaVersion == 1 || decoded.schemaVersion == 2 else {
            throw TodoDataFileError.unsupportedSchemaVersion(decoded.schemaVersion)
        }
        var migrated = decoded
        migrated.schemaVersion = 2
        if migrated.calendars.isEmpty && migrated.schemaVersion == 2 { migrated.calendars = [TodoData.personalCalendar()] }
        return migrated
    }

    static func load(from url: URL) throws -> TodoData {
        try decode(Data(contentsOf: url))
    }
}

enum TodoDataFileError: LocalizedError {
    case unsupportedSchemaVersion(Int)

    var errorDescription: String? {
        switch self {
        case .unsupportedSchemaVersion(let version): "Unsupported task data version: \(version)"
        }
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

enum DashboardRetention {
    static let days = 7
    static func earliestDay(today: String = DayMath.day(Date())) -> String {
        DayMath.add(1 - days, to: today) ?? today
    }
}
