import SwiftUI

struct TaskEditorView: View {
    @EnvironmentObject private var store: TodoStore
    @Environment(\.dismiss) private var dismiss
    @State private var task: TodoTask
    @State private var hasDue: Bool
    @State private var dueDate: Date
    @State private var hasTime: Bool
    @State private var dueTime: Date
    @State private var hasSchedule: Bool
    @State private var start: Date
    @State private var end: Date
    @State private var reminder = -1

    init(task: TodoTask) {
        _task = State(initialValue: task)
        _hasDue = State(initialValue: task.dueDay != nil)
        _dueDate = State(initialValue: task.dueDay.flatMap { DayMath.date($0) } ?? Date())
        _hasTime = State(initialValue: task.dueTime != nil)
        let pieces = task.dueTime?.split(separator: ":").compactMap { Int($0) } ?? []
        _dueTime = State(initialValue: pieces.count == 2
            ? Calendar.current.date(bySettingHour: pieces[0], minute: pieces[1], second: 0, of: Date()) ?? Date()
            : Date())
        _hasSchedule = State(initialValue: task.scheduledStart != nil)
        _start = State(initialValue: task.scheduledStart ?? Date())
        _end = State(initialValue: task.scheduledEnd ?? Date().addingTimeInterval(3600))
        _reminder = State(initialValue: task.reminderMinutes ?? -1)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Task") {
                    TextField("Title", text: $task.title)
                        .accessibilityIdentifier("task-title")
                    TextField("Notes", text: $task.notes, axis: .vertical)
                        .lineLimit(2...6)
                    Picker("Priority", selection: $task.priority) {
                        Text("None").tag(0)
                        Text("Low").tag(1)
                        Text("Medium").tag(2)
                        Text("High").tag(3)
                    }
                    Picker("Project", selection: $task.projectID) {
                        Text("Inbox").tag(Optional<UUID>.none)
                        ForEach(store.projects) { project in
                            Text(project.name).tag(Optional(project.id))
                        }
                    }
                    if let projectID = task.projectID {
                        Picker("Section", selection: $task.sectionID) {
                            Text("Project root").tag(Optional<UUID>.none)
                            ForEach(store.data.sections.filter { $0.projectID == projectID && $0.deletedAt == nil }) { section in
                                Text(section.name).tag(Optional(section.id))
                            }
                        }
                    }
                    Picker("Subtask of", selection: $task.parentTaskID) {
                        Text("No parent").tag(Optional<UUID>.none)
                        ForEach(store.activeTasks.filter { $0.id != task.id && $0.parentTaskID == nil && $0.projectID == task.projectID }) { parent in
                            Text(parent.title).tag(Optional(parent.id))
                        }
                    }
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
                    Toggle("Due date", isOn: $hasDue)
                    if hasDue {
                        DatePicker("Date", selection: $dueDate, displayedComponents: .date)
                        Toggle("Due time", isOn: $hasTime)
                        if hasTime {
                            DatePicker("Time", selection: $dueTime, displayedComponents: .hourAndMinute)
                        }
                    }
                }
                Section("Planned work") {
                    Text("Work time does not change the deadline.").font(.caption).foregroundStyle(.secondary)
                    Toggle("Schedule work", isOn: $hasSchedule)
                    if hasSchedule {
                        DatePicker("Starts", selection: $start)
                        DatePicker("Ends", selection: $end, in: start...)
                    }
                }
                Section("Repeat and remind") {
                    Picker("Repeat", selection: $task.frequency) {
                        ForEach(RepeatFrequency.allCases) { frequency in
                            Text(frequency.rawValue.capitalized).tag(frequency)
                        }
                    }
                    if task.frequency != .never {
                        Stepper("Every \(task.interval)", value: $task.interval, in: 1...365)
                    }
                    Picker("Reminder", selection: $reminder) {
                        Text("None").tag(-1)
                        Text("At due time").tag(0)
                        Text("15 minutes before").tag(15)
                        Text("1 hour before").tag(60)
                        Text("1 day before").tag(1440)
                    }
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
            .navigationTitle("Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(task.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                                  (hasSchedule && end <= start) ||
                                  (task.frequency != .never && !hasDue))
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
        task.scheduledStart = hasSchedule ? start : nil
        task.scheduledEnd = hasSchedule ? end : nil
        task.reminderMinutes = hasDue && hasTime && reminder >= 0 ? reminder : nil
        if task.frequency == .never {
            task.repeatAnchor = nil
        } else if task.repeatAnchor == nil || task.dueDay == nil {
            task.repeatAnchor = task.dueDay
        }
        store.save(task)
        dismiss()
    }
}
