import SwiftUI

struct ScheduledWorkEditorView: View {
    @EnvironmentObject private var store: TodoStore
    @Environment(\.dismiss) private var dismiss
    let task: TodoTask
    @State private var start: Date
    @State private var end: Date

    init(task: TodoTask, selectedDate: Date) {
        self.task = task
        let calendar = Calendar.current
        let base = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: selectedDate) ?? selectedDate
        _start = State(initialValue: task.scheduledStart ?? base)
        _end = State(initialValue: task.scheduledEnd ?? calendar.date(byAdding: .hour, value: 1, to: base) ?? base.addingTimeInterval(3600))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Planned work") {
                    Text(task.title).font(.headline)
                    DatePicker("Starts", selection: $start)
                    DatePicker("Ends", selection: $end, in: start...)
                    if let dueDay = task.dueDay { LabeledContent("Task due", value: dueDay) }
                    Text("Planning work is separate from the task deadline.").font(.caption).foregroundStyle(.secondary)
                }
                if task.scheduledStart != nil {
                    Section { Button("Remove planned time", role: .destructive) { store.unschedule(task.id); dismiss() } }
                }
            }
            .navigationTitle(task.scheduledStart == nil ? "Schedule work" : "Edit planned work")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { store.schedule(task.id, from: start, to: end); dismiss() }
                        .disabled(end <= start)
                }
            }
        }
    }
}
