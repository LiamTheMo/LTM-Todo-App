import SwiftUI

struct TaskEditorView: View {
    @EnvironmentObject private var store: TodoStore
    @Environment(\.dismiss) private var dismiss
    @FocusState private var titleFocused: Bool
    @State private var task: TodoTask
    @State private var hasDue: Bool
    @State private var dueDate: Date
    @State private var hasTime: Bool
    @State private var dueTime: Date
    @State private var reminder = -1
    @State private var hasRepeatUntil: Bool
    @State private var repeatUntil: Date
    @State private var hasRepeatCount: Bool
    @State private var repeatCount: Int
    private let originalDueDay: String?
    private var earliestDueDate: Date { DayMath.date(DashboardRetention.earliestDay()) ?? Calendar.current.startOfDay(for: Date()) }

    init(task: TodoTask) {
        originalDueDay = task.dueDay
        _task = State(initialValue: task)
        _hasDue = State(initialValue: task.dueDay != nil)
        _dueDate = State(initialValue: task.dueDay.flatMap { DayMath.date($0) } ?? Date())
        _hasTime = State(initialValue: task.dueTime != nil)
        let pieces = task.dueTime?.split(separator: ":").compactMap { Int($0) } ?? []
        _dueTime = State(initialValue: pieces.count == 2
            ? Calendar.current.date(bySettingHour: pieces[0], minute: pieces[1], second: 0, of: Date()) ?? Date()
            : Date())
        _reminder = State(initialValue: task.reminderMinutes ?? -1)
        _hasRepeatUntil = State(initialValue: task.repeatUntil != nil)
        _repeatUntil = State(initialValue: task.repeatUntil.flatMap { DayMath.date($0) } ?? Date())
        _hasRepeatCount = State(initialValue: task.repeatCount != nil)
        _repeatCount = State(initialValue: task.repeatCount ?? 2)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Task") {
                    TextField("Title", text: $task.title)
                        .accessibilityIdentifier("task-title")
                        .focused($titleFocused)
                    TextField("Notes", text: $task.notes, axis: .vertical)
                        .lineLimit(2...6)
                    CustomDropdownSelector(title: "Priority", selection: $task.priority, options: [
                        DropdownOption(value: 0, title: "None"), DropdownOption(value: 1, title: "Low"),
                        DropdownOption(value: 2, title: "Medium"), DropdownOption(value: 3, title: "High")
                    ])
                    CustomDropdownSelector(title: "Project", selection: $task.projectID,
                        options: [DropdownOption(value: Optional<UUID>.none, title: "Inbox")] + store.projects.map {
                            DropdownOption(value: Optional($0.id), title: $0.name)
                        })
                    if let projectID = task.projectID {
                        CustomDropdownSelector(title: "Section", selection: $task.sectionID,
                            options: [DropdownOption(value: Optional<UUID>.none, title: "Project root")] + store.data.sections
                                .filter { $0.projectID == projectID && $0.deletedAt == nil }
                                .map { DropdownOption(value: Optional($0.id), title: $0.name) })
                    }
                    CustomDropdownSelector(title: "Subtask of", selection: $task.parentTaskID,
                        options: [DropdownOption(value: Optional<UUID>.none, title: "No parent")] + store.activeTasks
                            .filter { $0.id != task.id && $0.parentTaskID == nil && $0.projectID == task.projectID }
                            .map { DropdownOption(value: Optional($0.id), title: $0.title) })
                    .onChange(of: task.projectID) { _, _ in
                        task.sectionID = nil
                        task.parentTaskID = nil
                    }
                }
                if !store.data.tags.filter({ $0.deletedAt == nil }).isEmpty {
                    Section("Tags") {
                        ForEach(store.data.tags.filter { $0.deletedAt == nil }) { tag in
                            Toggle(tag.name, isOn: Binding(
                                get: { task.tagIDs.contains(tag.id) },
                                set: { enabled in
                                    if enabled { task.tagIDs.append(tag.id) }
                                    else { task.tagIDs.removeAll { $0 == tag.id } }
                                }
                            ))
                        }
                    }
                }
                Section("Deadline") {
                    Toggle("Date", isOn: $hasDue)
                    if hasDue {
                        DatePicker("Date", selection: $dueDate, in: earliestDueDate..., displayedComponents: .date)
                        Toggle("Time", isOn: $hasTime)
                        if hasTime {
                            DatePicker("Time", selection: $dueTime, displayedComponents: .hourAndMinute)
                        }
                    }
                }
                Section("Repeat and remind") {
                    CustomDropdownSelector(title: "Repeat", selection: $task.frequency,
                        options: RepeatFrequency.allCases.map { DropdownOption(value: $0, title: $0.rawValue.capitalized) })
                    if task.frequency != .never {
                        Stepper("Every \(task.interval)", value: $task.interval, in: 1...365)
                        if task.frequency == .weekly {
                            ForEach(0..<7, id: \.self) { day in
                                Toggle(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day],
                                    isOn: Binding(
                                        get: { task.repeatWeekdays?.contains(day) ?? false },
                                        set: { enabled in
                                            var days = task.repeatWeekdays ?? []
                                            if enabled && !days.contains(day) { days.append(day) }
                                            if !enabled { days.removeAll { $0 == day } }
                                            task.repeatWeekdays = days
                                        }
                                    ))
                            }
                            Text("With no days selected, repeat on the original weekday.").font(.caption).foregroundStyle(.secondary)
                        }
                        Toggle("End on date", isOn: $hasRepeatUntil)
                        if hasRepeatUntil { DatePicker("Last date", selection: $repeatUntil, in: dueDate..., displayedComponents: .date) }
                        Toggle("End after occurrences", isOn: $hasRepeatCount)
                        if hasRepeatCount { Stepper("\(repeatCount) occurrences", value: $repeatCount, in: 1...999) }
                    }
                    CustomDropdownSelector(title: "Reminder", selection: $reminder, options: [
                        DropdownOption(value: -1, title: "None"), DropdownOption(value: 0, title: "At due time"),
                        DropdownOption(value: 5, title: "5 minutes before"), DropdownOption(value: 10, title: "10 minutes before"),
                        DropdownOption(value: 15, title: "15 minutes before"), DropdownOption(value: 30, title: "30 minutes before"),
                        DropdownOption(value: 45, title: "45 minutes before"), DropdownOption(value: 60, title: "1 hour before"),
                        DropdownOption(value: 120, title: "2 hours before"), DropdownOption(value: 1440, title: "1 day before")
                    ])
                    if reminder >= 0 && !(hasDue && hasTime) {
                        Text("Choose a due date and time for a reminder.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if store.data.tasks.contains(where: { $0.id == task.id }) {
                    Section {
                        Button("Delete task", role: .destructive) {
                            store.delete(task.id)
                            dismiss()
                        }
                    }
                }
            }
            .onAppear { titleFocused = false }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(task.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                                  (task.frequency != .never && !hasDue) ||
                                  (hasDue && DayMath.day(dueDate) < DashboardRetention.earliestDay()))
                        .accessibilityIdentifier("save-task")
                }
            }
        }
    }

    private func save() {
        task.dueDay = hasDue ? DayMath.day(dueDate) : nil
        task.dueTime = hasDue && hasTime ? String(format: "%02d:%02d",
            Calendar.current.component(.hour, from: dueTime),
            Calendar.current.component(.minute, from: dueTime)) : nil
        task.reminderMinutes = hasDue && hasTime && reminder >= 0 ? reminder : nil
        if task.frequency == .never {
            task.repeatAnchor = nil
            task.repeatWeekdays = nil
            task.repeatUntil = nil
            task.repeatCount = nil
        } else {
            task.repeatUntil = hasRepeatUntil ? DayMath.day(repeatUntil) : nil
            task.repeatCount = hasRepeatCount ? repeatCount : nil
            if task.frequency != .weekly { task.repeatWeekdays = nil }
        }
        if task.frequency != .never && (task.repeatAnchor == nil || task.dueDay != originalDueDay) {
            task.repeatAnchor = task.dueDay
        }
        store.save(task)
        dismiss()
    }
}
