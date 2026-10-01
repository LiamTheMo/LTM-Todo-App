import SwiftUI

struct CalendarEventEditorView: View {
    @EnvironmentObject private var store: TodoStore
    @Environment(\.dismiss) private var dismiss
    @State private var event: TodoCalendarEvent
    @State private var startDate: Date
    @State private var endDate: Date

    init(event: TodoCalendarEvent) {
        _event = State(initialValue: event)
        let zone = TimeZone(identifier: event.timeZoneID ?? "") ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let start = event.startDay.flatMap { DayMath.date($0, calendar: calendar) } ?? event.startInstant ?? Date()
        let storedEnd = event.endDay.flatMap { DayMath.date($0, calendar: calendar) } ?? event.endInstant ?? start.addingTimeInterval(3600)
        _startDate = State(initialValue: start)
        _endDate = State(initialValue: event.allDay ? (calendar.date(byAdding: .day, value: -1, to: storedEnd) ?? start) : storedEnd)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Event") {
                    TextField("Title", text: $event.title)
                    TextField("Notes", text: $event.notes, axis: .vertical).lineLimit(2...5)
                    Picker("Calendar", selection: $event.calendarID) {
                        ForEach(store.visibleCalendars) { calendar in Text(calendar.name).tag(calendar.id) }
                    }
                    Toggle("All day", isOn: $event.allDay)
                }
                Section("When") {
                    DatePicker("Starts", selection: $startDate, displayedComponents: event.allDay ? .date : [.date, .hourAndMinute])
                    DatePicker("Ends", selection: $endDate, in: startDate..., displayedComponents: event.allDay ? .date : [.date, .hourAndMinute])
                    if !event.allDay { Text("Times use \(TimeZone.current.identifier). Repeating events keep this local time across daylight saving changes.").font(.caption).foregroundStyle(.secondary) }
                }
                Section("Repeat") {
                    Picker("Frequency", selection: Binding(get: { event.recurrence?.frequency ?? .never }, set: { frequency in
                        event.recurrence = frequency == .never ? nil : TodoEventRecurrence(frequency: frequency)
                    })) {
                        Text("Never").tag(RepeatFrequency.never)
                        Text("Daily").tag(RepeatFrequency.daily)
                        Text("Weekly").tag(RepeatFrequency.weekly)
                        Text("Monthly").tag(RepeatFrequency.monthly)
                        Text("Yearly").tag(RepeatFrequency.yearly)
                    }
                    if event.recurrence != nil {
                        Stepper("Every \(event.recurrence?.interval ?? 1)", value: Binding(get: { event.recurrence?.interval ?? 1 }, set: { event.recurrence?.interval = $0 }), in: 1...365)
                        DatePicker("Repeat until", selection: Binding(get: { DayMath.date(event.recurrence?.until ?? "") ?? startDate }, set: { event.recurrence?.until = DayMath.day($0) }), in: startDate..., displayedComponents: .date)
                    }
                }
            }
            .navigationTitle(event.title.isEmpty ? "New event" : "Edit event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(event.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.visibleCalendars.isEmpty)
                }
                if event.revision > 1 || store.data.calendarEvents.contains(where: { $0.id == event.id && $0.deletedAt == nil }) {
                    ToolbarItem(placement: .bottomBar) { Button("Delete event series", role: .destructive) { store.deleteCalendarEvent(event.id); dismiss() } }
                }
            }
        }
    }

    private func save() {
        let zone = TimeZone.current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        event.timeZoneID = zone.identifier
        if event.allDay {
            event.startDay = DayMath.day(startDate, calendar: calendar)
            event.endDay = DayMath.add(1, to: DayMath.day(endDate, calendar: calendar), calendar: calendar)
            event.startInstant = nil
            event.endInstant = nil
        } else {
            event.startInstant = startDate
            event.endInstant = endDate
            event.startDay = nil
            event.endDay = nil
        }
        store.save(event)
        dismiss()
    }
}
