import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard", tasks = "Tasks", projects = "Projects", calendar = "Calendar", settings = "Settings"
    var id: Self { self }
}

private func dueTimeCaption(_ value: String) -> String {
    let pieces = value.split(separator: ":").compactMap { Int($0) }
    guard pieces.count == 2, (0...23).contains(pieces[0]), (0...59).contains(pieces[1]) else { return value }
    let suffix = pieces[0] < 12 ? "am" : "pm"
    return String(format: "%d:%02d%@", pieces[0] % 12 == 0 ? 12 : pieces[0] % 12, pieces[1], suffix)
}

struct RootView: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @EnvironmentObject private var store: TodoStore
    @State private var selection: AppSection = .dashboard
    @State private var editing: TodoTask?

    var body: some View {
        Group {
            if sizeClass == .regular {
                NavigationSplitView {
                    List(AppSection.allCases) { section in
                        Button { selection = section } label: {
                            HStack(spacing: 12) {
                                TabIcon(section: section, isSelected: selection == section)
                                if section != .settings {
                                    Text(section.rawValue)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(section.rawValue)
                        .foregroundStyle(selection == section ? LTMTheme.accent : Color.primary)
                        .accessibilityAddTraits(selection == section ? .isSelected : [])
                    }
                    .navigationTitle("LTM Todo")
                } detail: { destination(for: selection) }
            } else {
                TabView(selection: $selection) {
                    ForEach(AppSection.allCases) { section in
                        destination(for: section)
                            .tabItem {
                                if section == .settings {
                                    Image(uiImage: TabIconImage.image(for: section))
                                        .renderingMode(.template)
                                        .accessibilityLabel(section.rawValue)
                                } else {
                                    Label {
                                        Text(section.rawValue)
                                    } icon: {
                                        Image(uiImage: TabIconImage.image(for: section))
                                            .renderingMode(.template)
                                    }
                                }
                            }
                            .tag(section)
                    }
                }
            }
        }
        .tint(LTMTheme.accent)
        .sheet(item: $editing) { task in TaskEditorView(task: task) }
        .safeAreaInset(edge: .top) {
            if let message = store.errorMessage {
                Text(message).font(.caption).frame(maxWidth: .infinity)
                    .padding(8).background(Color.red.opacity(0.15))
            }
        }
    }

    @ViewBuilder
    private func destination(for section: AppSection) -> some View {
        switch section {
        case .dashboard: DashboardView()
        case .tasks: TaskListView(title: "Tasks", projectID: nil)
        case .projects: ProjectsView()
        case .calendar: CalendarView()
        case .settings: SettingsView()
        }
    }
}

private struct CalendarMonthPreview: Identifiable {
    let id: String
    let title: String
    let color: Color
}

struct CalendarView: View {
    @EnvironmentObject private var store: TodoStore
    @State private var selectedDate = Calendar.current.startOfDay(for: Date())
    @State private var displayedMonth = Calendar.current.dateInterval(of: .month, for: Date())?.start ?? Date()
    @State private var editing: TodoTask?
    @State private var editingEvent: TodoCalendarEvent?
    @State private var showingNewCalendar = false
    @State private var newCalendarName = ""
    @State private var scheduleTask: TodoTask?
    @State private var showingSchedulePicker = false

    private var selectedDay: String { DayMath.day(selectedDate) }
    private var earliestDate: Date { DayMath.date(DashboardRetention.earliestDay()) ?? Calendar.current.startOfDay(for: Date()) }
    private var calendar: Calendar { Calendar.current }
    private var monthDates: [Date] {
        guard let monthStart = calendar.dateInterval(of: .month, for: displayedMonth)?.start else { return [] }
        let weekdayOffset = (calendar.component(.weekday, from: monthStart) - calendar.firstWeekday + 7) % 7
        guard let gridStart = calendar.date(byAdding: .day, value: -weekdayOffset, to: monthStart) else { return [] }
        return (0..<42).compactMap { calendar.date(byAdding: .day, value: $0, to: gridStart) }
    }
    private var allDayEvents: [TodoCalendarEvent] { store.calendarEvents(on: selectedDay).filter(\.allDay) }
    private var dueTasks: [TodoTask] { store.activeTasks.filter { $0.dueDay == selectedDay } }
    private var timedItems: [CalendarTimedItem] {
        let events = store.calendarEvents(on: selectedDay).compactMap { event -> CalendarTimedItem? in
            guard let (start, end) = timedInterval(for: event) else { return nil }
            return CalendarTimedItem(id: "event-\(event.id)", title: event.title,
                caption: "Event · \(start.formatted(date: .omitted, time: .shortened)) – \(end.formatted(date: .omitted, time: .shortened))",
                start: start, end: end, color: color(for: store.visibleCalendars.first { $0.id == event.calendarID }?.color ?? .orange))
        }
        let scheduled = store.activeTasks.compactMap { task -> CalendarTimedItem? in
            guard let start = task.scheduledStart, calendar.isDate(start, inSameDayAs: selectedDate) else { return nil }
            let end = task.scheduledEnd ?? start.addingTimeInterval(3600)
            let dueLabel = task.dueDay == selectedDay ? task.dueTime.map { " · Due \(dueTimeCaption($0))" } ?? " · Due today" : ""
            return CalendarTimedItem(id: "task-\(task.id)", title: task.title,
                caption: "Planned work\(dueLabel)", start: start, end: end, color: .blue)
        }
        let timedDeadlines = dueTasks.compactMap { task -> CalendarTimedItem? in
            guard task.scheduledStart == nil, let dueTime = task.dueTime else { return nil }
            let parts = dueTime.split(separator: ":").compactMap { Int($0) }
            guard parts.count == 2, let start = calendar.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: selectedDate) else { return nil }
            return CalendarTimedItem(id: "deadline-\(task.id)", title: task.title,
                caption: "Task deadline", start: start, end: start.addingTimeInterval(30 * 60), color: .orange)
        }
        return (events + scheduled + timedDeadlines).sorted { $0.start < $1.start }
    }

    private func timedInterval(for event: TodoCalendarEvent) -> (Date, Date)? {
        guard !event.allDay, let start = event.startInstant, let end = event.endInstant, end > start else { return nil }
        let duration = end.timeIntervalSince(start)
        if event.recurrence != nil {
            var eventCalendar = Calendar(identifier: .gregorian)
            eventCalendar.timeZone = TimeZone(identifier: event.timeZoneID ?? "") ?? .current
            guard let eventDay = DayMath.date(selectedDay, calendar: eventCalendar) else { return nil }
            let startParts = eventCalendar.dateComponents([.hour, .minute, .second], from: start)
            guard let occurrenceStart = eventCalendar.date(bySettingHour: startParts.hour ?? 0, minute: startParts.minute ?? 0,
                second: startParts.second ?? 0, of: eventDay) else { return nil }
            return (occurrenceStart, occurrenceStart.addingTimeInterval(duration))
        }
        let dayStart = calendar.startOfDay(for: selectedDate)
        guard let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) else { return nil }
        let clippedStart = max(start, dayStart)
        let clippedEnd = min(end, dayEnd)
        return clippedEnd > clippedStart ? (clippedStart, clippedEnd) : nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        Button { shiftMonth(-1) } label: { Image(systemName: "chevron.left") }
                            .accessibilityLabel("Previous month")
                        Spacer()
                        Text(displayedMonth.formatted(.dateTime.month(.wide).year())).font(.headline)
                            .accessibilityIdentifier("calendar-month-title")
                        Spacer()
                        Button { shiftMonth(1) } label: { Image(systemName: "chevron.right") }
                            .accessibilityLabel("Next month")
                        Button("Today") {
                            selectedDate = calendar.startOfDay(for: Date())
                            displayedMonth = calendar.dateInterval(of: .month, for: Date())?.start ?? Date()
                        }
                    }
                    .buttonStyle(.borderless)
                    .padding(.horizontal)

                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 7), spacing: 5) {
                        ForEach(weekdaySymbols, id: \.self) { symbol in
                            Text(symbol).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity).accessibilityHidden(true)
                        }
                        ForEach(monthDates, id: \.self) { date in
                            calendarCell(for: date)
                        }
                    }
                    .padding(.horizontal, 8)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(store.visibleCalendars) { item in
                                Toggle(isOn: Binding(get: { item.visible }, set: { store.setCalendarVisible(item.id, visible: $0) })) {
                                    Label(item.name, systemImage: "circle.fill").labelStyle(.titleAndIcon)
                                        .foregroundStyle(color(for: item.color))
                                }
                                .toggleStyle(.button)
                                .font(.caption)
                            }
                            Button { showingNewCalendar = true } label: { Label("Add calendar", systemImage: "plus") }
                                .font(.caption)
                        }
                        .padding(.horizontal)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Text(selectedDate.formatted(date: .complete, time: .omitted))
                            .font(.title3.weight(.semibold))
                            .padding(.horizontal)
                        if !allDayEvents.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("ALL DAY").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                ForEach(allDayEvents) { event in
                                    Button { editingEvent = event } label: {
                                        HStack(spacing: 8) {
                                            Circle().fill(color(for: store.visibleCalendars.first { $0.id == event.calendarID }?.color ?? .orange)).frame(width: 9, height: 9)
                                            Text(event.title).foregroundStyle(.primary)
                                            Spacer()
                                            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary)
                                        }.padding(9).background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                                    }.buttonStyle(.plain)
                                }
                            }.padding(.horizontal)
                        }

                        HStack {
                            Text("TIMELINE").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            Spacer()
                            if calendar.isDate(selectedDate, inSameDayAs: Date()) {
                                Text("Now · \(Date.now.formatted(date: .omitted, time: .shortened))")
                                    .font(.caption2.weight(.medium)).foregroundStyle(.red)
                            }
                        }.padding(.horizontal)
                        CalendarDayTimeline(day: selectedDate, items: timedItems)
                            .padding(.horizontal, 8)

                        if !dueTasks.isEmpty {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("DUE THAT DAY").font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.horizontal)
                                ForEach(dueTasks) { task in
                                    TaskRow(task: task, subtitle: task.dueTime.map { "Due \(dueTimeCaption($0))" } ?? "Due today") { editing = task }
                                }
                            }.padding(.horizontal)
                        }
                        if allDayEvents.isEmpty && timedItems.isEmpty && dueTasks.isEmpty {
                            ContentUnavailableView("Nothing planned", systemImage: "calendar", description: Text("Events, planned work, and task deadlines for this day will appear here."))
                                .padding(.top, 16)
                        }
                    }
                }
                .padding(.vertical, 12)
            }
            .navigationTitle("Calendar")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    CustomDropdownMenu(label: "Add", actions: [
                        DropdownMenuAction(id: "task", title: "Add task", systemImage: "checkmark.circle") { editing = TodoTask(title: "", dueDay: selectedDay) },
                        DropdownMenuAction(id: "event", title: "Add event", systemImage: "calendar.badge.plus") {
                            editingEvent = TodoCalendarEvent(calendarID: store.visibleCalendars.first?.id ?? UUID(), title: "", allDay: true, startDay: selectedDay, endDay: DayMath.add(1, to: selectedDay))
                        },
                        DropdownMenuAction(id: "schedule", title: "Schedule task", systemImage: "clock") { showingSchedulePicker = true }
                    ])
                }
            }
            .sheet(item: $editing) { task in TaskEditorView(task: task) }
            .sheet(item: $editingEvent) { event in CalendarEventEditorView(event: event) }
            .sheet(item: $scheduleTask) { task in ScheduledWorkEditorView(task: task, selectedDate: selectedDate) }
            .sheet(isPresented: $showingSchedulePicker) {
                NavigationStack {
                    List(store.activeTasks) { task in
                        Button { showingSchedulePicker = false; scheduleTask = task } label: {
                            VStack(alignment: .leading) { Text(task.title).foregroundStyle(.primary); Text(task.dueDay.map { "Due \($0)" } ?? "No deadline").font(.caption).foregroundStyle(.secondary) }
                        }
                    }.navigationTitle("Choose a task").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showingSchedulePicker = false } } }
                }
            }
            .alert("New calendar", isPresented: $showingNewCalendar) {
                TextField("Calendar name", text: $newCalendarName)
                Button("Cancel", role: .cancel) { newCalendarName = "" }
                Button("Create") { store.addCalendar(name: newCalendarName, color: TodoCalendarColor.allCases[store.visibleCalendars.count % TodoCalendarColor.allCases.count]); newCalendarName = "" }
            }
        }
    }

    private var weekdaySymbols: [String] {
        let symbols = calendar.veryShortStandaloneWeekdaySymbols
        let start = max(0, calendar.firstWeekday - 1)
        return Array(symbols[start...] + symbols[..<start])
    }

    private func shiftMonth(_ amount: Int) {
        guard let next = calendar.date(byAdding: .month, value: amount, to: displayedMonth),
              let start = calendar.dateInterval(of: .month, for: next)?.start else { return }
        displayedMonth = start
        if calendar.component(.month, from: selectedDate) != calendar.component(.month, from: start) ||
            calendar.component(.year, from: selectedDate) != calendar.component(.year, from: start) {
            selectedDate = start
        }
    }

    @ViewBuilder
    private func calendarCell(for date: Date) -> some View {
        let day = DayMath.day(date)
        let inMonth = calendar.isDate(date, equalTo: displayedMonth, toGranularity: .month)
        let disabled = calendar.startOfDay(for: date) < calendar.startOfDay(for: earliestDate)
        let dayEvents = store.calendarEvents(on: day)
        let eventCalendars = Dictionary(uniqueKeysWithValues: store.visibleCalendars.map { ($0.id, $0.color) })
        let dayTasks = store.activeTasks.filter { task in
            task.dueDay == day || task.scheduledStart.map { calendar.isDate($0, inSameDayAs: date) } == true
        }
        let previews = dayEvents.map { event in
            CalendarMonthPreview(id: "event-\(event.id)", title: event.title,
                color: color(for: eventCalendars[event.calendarID] ?? .orange))
        } + dayTasks.map { task in
            CalendarMonthPreview(id: "task-\(task.id)", title: task.title,
                color: task.scheduledStart.map { calendar.isDate($0, inSameDayAs: date) } == true ? .blue : .orange)
        }
        Button { selectedDate = calendar.startOfDay(for: date) } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(date.formatted(.dateTime.day()))
                    .font(.caption.weight(calendar.isDateInToday(date) ? .bold : .medium))
                    .foregroundStyle(calendar.isDateInToday(date) ? Color.white : inMonth ? Color.primary : Color.secondary)
                    .frame(width: 23, height: 23)
                    .background(calendar.isDateInToday(date) ? LTMTheme.accent : .clear, in: Circle())
                ForEach(Array(previews.prefix(2))) { preview in
                    HStack(spacing: 3) {
                        Circle().fill(preview.color).frame(width: 4, height: 4)
                        Text(preview.title).font(.system(size: 8, weight: .medium)).lineLimit(1).truncationMode(.tail)
                            .foregroundStyle(.primary)
                    }.accessibilityHidden(true)
                }
                if previews.count > 2 {
                    Text("+\(previews.count - 2) more").font(.system(size: 7)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 62, maxHeight: 62, alignment: .topLeading)
            .padding(4)
            .background(calendar.isDate(date, inSameDayAs: selectedDate) ? LTMTheme.accent.opacity(0.14) : Color.secondary.opacity(0.045),
                        in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(calendar.isDate(date, inSameDayAs: selectedDate) ? LTMTheme.accent : .clear, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.38 : 1)
        .accessibilityLabel(date.formatted(date: .complete, time: .omitted) + (previews.isEmpty ? ", no calendar items" : ", \(previews.count) calendar items"))
        .accessibilityAddTraits(calendar.isDate(date, inSameDayAs: selectedDate) ? .isSelected : [])
    }

    private func color(for color: TodoCalendarColor) -> Color {
        switch color {
        case .orange: .orange
        case .blue: .blue
        case .green: .green
        case .purple: .purple
        case .red: .red
        case .teal: .teal
        }
    }

}

struct TaskListView: View {
    @EnvironmentObject private var store: TodoStore
    let title: String
    let projectID: UUID?
    @State private var quickTitle = ""
    @State private var query = ""
    @State private var editing: TodoTask?
    @State private var priorityFilter = -1
    @State private var statusFilter = 0
    @State private var projectFilter = "all"
    @State private var tagFilter = "all"
    @State private var dateFilter = "all"
    @State private var sectionName = ""
    @State private var sectionToDelete: UUID?

    private var isMaster: Bool { projectID == nil }
    private var filterDescription: String {
        var labels = [isMaster ? (statusFilter == 0 ? "Open" : statusFilter == 1 ? "Completed" : "All statuses") : "Open"]
        if !query.isEmpty { labels.append("Search: \(query)") }
        if projectFilter != "all" {
            if projectFilter == "inbox" { labels.append("Inbox") }
            else { labels.append(store.projects.first(where: { $0.id.uuidString == projectFilter })?.name ?? "Archived project") }
        }
        if priorityFilter >= 0 { labels.append("Priority \(priorityFilter)") }
        if tagFilter != "all" { labels.append(store.data.tags.first(where: { $0.id.uuidString == tagFilter })?.name ?? "Deleted tag") }
        if dateFilter != "all" { labels.append(dateFilter) }
        return labels.joined(separator: " · ")
    }
    private var visible: [TodoTask] {
        let today = DayMath.day(Date())
        return (isMaster ? store.unarchivedTasks : store.activeTasks).filter { task in
            (projectID == nil || task.projectID == projectID) &&
            (query.isEmpty || task.title.localizedCaseInsensitiveContains(query) || task.notes.localizedCaseInsensitiveContains(query)) &&
            (priorityFilter < 0 || task.priority == priorityFilter) &&
            (!isMaster || (statusFilter == 2 || (task.completedAt != nil) == (statusFilter == 1))) &&
            (!isMaster || projectFilter == "all" || (projectFilter == "inbox" ? task.projectID == nil : task.projectID?.uuidString == projectFilter)) &&
            (tagFilter == "all" || task.tagIDs.contains { $0.uuidString == tagFilter }) &&
            (dateFilter == "all" || (dateFilter == "undated" ? task.dueDay == nil : task.dueDay.map {
                dateFilter == "today" ? $0 == today : dateFilter == "overdue" ? $0 < today : $0 > today
            } ?? false))
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        TextField("Add a task…", text: $quickTitle)
                            .onSubmit { add() }
                            .submitLabel(.done)
                        Button("Add", action: add).disabled(quickTitle.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                    CustomDropdownSelector(title: "Priority", selection: $priorityFilter, options: [
                        DropdownOption(value: -1, title: "All"), DropdownOption(value: 0, title: "None"),
                        DropdownOption(value: 1, title: "Low"), DropdownOption(value: 2, title: "Medium"),
                        DropdownOption(value: 3, title: "High")
                    ])
                    if isMaster {
                        CustomDropdownSelector(title: "Status", selection: $statusFilter, options: [
                            DropdownOption(value: 0, title: "Open"), DropdownOption(value: 1, title: "Completed"),
                            DropdownOption(value: 2, title: "All statuses")
                        ])
                        CustomDropdownSelector(title: "Project", selection: $projectFilter,
                            options: [DropdownOption(value: "all", title: "All projects"), DropdownOption(value: "inbox", title: "Inbox")] + store.projects.map {
                                DropdownOption(value: $0.id.uuidString, title: $0.name)
                            })
                    }
                    CustomDropdownSelector(title: "Tag", selection: $tagFilter,
                        options: [DropdownOption(value: "all", title: "All tags")] + store.data.tags.filter { $0.deletedAt == nil }.map {
                            DropdownOption(value: $0.id.uuidString, title: $0.name)
                        })
                    CustomDropdownSelector(title: "Due date", selection: $dateFilter, options: [
                        DropdownOption(value: "all", title: "Any due date"), DropdownOption(value: "overdue", title: "Overdue"),
                        DropdownOption(value: "today", title: "Due today"), DropdownOption(value: "upcoming", title: "Upcoming"),
                        DropdownOption(value: "undated", title: "No due date")
                    ])
                Text("\(visible.count) results · \(filterDescription)")
                    .font(.caption).foregroundStyle(.secondary)
                if let projectID {
                    Section("Project tasks") {
                        ForEach(visible.filter { $0.sectionID == nil }) { task in
                            TaskRow(task: task, showReorderControls: true) { editing = task }
                        }
                    }
                    ForEach(store.data.sections.filter { $0.projectID == projectID && $0.deletedAt == nil }
                        .sorted { $0.sortKey == $1.sortKey ? $0.id.uuidString < $1.id.uuidString : $0.sortKey < $1.sortKey }) { section in
                        Section(section.name) {
                            ForEach(visible.filter { $0.sectionID == section.id }) { task in
                                TaskRow(task: task, showReorderControls: true) { editing = task }
                            }
                            HStack {
                                Button { store.moveSection(section.id, by: -1) } label: { Label("Move up", systemImage: "arrow.up") }
                                Button { store.moveSection(section.id, by: 1) } label: { Label("Move down", systemImage: "arrow.down") }
                                Button("Delete section", role: .destructive) { sectionToDelete = section.id }
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                    Section("New section") {
                        HStack {
                            TextField("Section name", text: $sectionName)
                            Button("Add") { store.addSection(sectionName, to: projectID); sectionName = "" }
                                .disabled(sectionName.isEmpty)
                        }
                    }
                } else {
                    Section {
                        ForEach(visible) { task in TaskRow(task: task) { editing = task } }
                    }
                }
            }
            .searchable(text: $query, prompt: "Search title and notes")
            .navigationTitle(title)
            .toolbar {
                Button { editing = TodoTask(title: "", projectID: projectID) } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Add task")
            }
            .sheet(item: $editing) { task in TaskEditorView(task: task) }
            .confirmationDialog("Delete section? Its tasks will move to the project root.", isPresented: Binding(
                get: { sectionToDelete != nil }, set: { if !$0 { sectionToDelete = nil } }
            )) {
                Button("Delete section", role: .destructive) {
                    if let sectionToDelete { store.deleteSection(sectionToDelete) }
                    sectionToDelete = nil
                }
            }
        }
    }

    private func add() {
        store.quickAdd(quickTitle, projectID: projectID)
        quickTitle = ""
    }
}

struct TaskRow: View {
    @EnvironmentObject private var store: TodoStore
    let task: TodoTask
    var completion: TodoCompletion? = nil
    var subtitle: String? = nil
    var showReorderControls = false
    var schedule: (() -> Void)? = nil
    let edit: () -> Void

    private var isCompleted: Bool { completion != nil || task.completedAt != nil }
    private var canUndoCompletion: Bool {
        guard let completion else { return true }
        return store.data.completions.last(where: { $0.taskID == task.id })?.id == completion.id
    }

    var body: some View {
        HStack(spacing: 12) {
            Button {
                if let completion {
                    store.undoCompletion(completion.id)
                } else if task.completedAt != nil, let completion = store.data.completions.last(where: { $0.taskID == task.id }) {
                    store.undoCompletion(completion.id)
                } else { store.complete(task.id) }
            } label: { Image(systemName: isCompleted ? "checkmark.circle.fill" : "circle").font(.title3) }
                .disabled(!canUndoCompletion || (!isCompleted && store.activeTasks.contains(where: { $0.parentTaskID == task.id })))
                .accessibilityLabel(isCompleted ? "Reopen \(task.title)" : store.activeTasks.contains(where: { $0.parentTaskID == task.id }) ? "Finish subtasks before completing \(task.title)" : "Complete \(task.title)")
            Button(action: edit) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(task.title).foregroundStyle(isCompleted ? Color.secondary : Color.primary).strikethrough(isCompleted)
                    if let subtitle {
                        Text(subtitle).font(.caption).foregroundStyle(.secondary)
                    } else if let completion {
                        Text("Completed \(completion.completedAt.formatted(date: .omitted, time: .shortened))")
                            .font(.caption).foregroundStyle(.secondary)
                    } else if let day = task.dueDay {
                        Text("Due \(day)").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, task.parentTaskID == nil ? 0 : 16)
            }
            .buttonStyle(.plain)
            if !isCompleted, let schedule {
                Button(action: schedule) { Image(systemName: "clock.badge.plus") }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Schedule work for \(task.title)")
            }
            if showReorderControls {
                VStack(spacing: 4) {
                    Button { store.moveTask(task.id, by: -1) } label: {
                        Image(systemName: "arrow.up")
                    }
                    .accessibilityLabel("Move task \(task.title) up")
                    Button { store.moveTask(task.id, by: 1) } label: {
                        Image(systemName: "arrow.down")
                    }
                    .accessibilityLabel("Move task \(task.title) down")
                }
                .buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 4)
        .opacity(isCompleted ? 0.72 : 1)
    }
}

struct SettingsView: View {
    @EnvironmentObject private var store: TodoStore
    @State private var tagName = ""
    @State private var templateName = ""
    @State private var templateTitle = ""
    @State private var routineName = ""
    @State private var routineTemplateID: UUID?
    @State private var routineStart = Date()
    @State private var routineFrequency: RepeatFrequency = .weekly
    @State private var routineInterval = 1

    var body: some View {
        NavigationStack {
            List {
                Section("Your data") {
                    Text("Tasks are stored on this device. Cross-device sync arrives in a later phase.")
                    Text("Notifications need permission and a due date with a time.")
                    if let backupURL = store.backupURL {
                        ShareLink(item: backupURL) {
                            Label("Export local backup JSON", systemImage: "square.and.arrow.up")
                        }
                    }
                }
                Section("Tags") {
                    HStack {
                        TextField("New tag", text: $tagName)
                        Button("Add") { store.addTag(tagName); tagName = "" }.disabled(tagName.isEmpty)
                    }
                    ForEach(store.data.tags.filter { $0.deletedAt == nil }) { tag in
                        TagRow(tag: tag)
                    }
                }
                Section("Task templates") {
                    TextField("Template name", text: $templateName)
                    TextField("Task title", text: $templateTitle)
                    Button("Save template") {
                        store.saveTemplate(name: templateName, from: TodoTask(title: templateTitle))
                        templateName = ""
                        templateTitle = ""
                    }.disabled(templateName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || templateTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    ForEach(store.data.taskTemplates.filter { $0.deletedAt == nil }) { template in
                        HStack {
                            VStack(alignment: .leading) { Text(template.name); Text(template.title).font(.caption).foregroundStyle(.secondary) }
                            Spacer()
                            Button("Create task") { store.createFromTemplate(template.id) }
                        }
                    }
                }
                Section("Routines") {
                    TextField("Routine name", text: $routineName)
                    CustomDropdownSelector(title: "Template", selection: $routineTemplateID,
                        options: [DropdownOption(value: Optional<UUID>.none, title: "Choose template")] + store.data.taskTemplates
                            .filter { $0.deletedAt == nil }.map { DropdownOption(value: Optional($0.id), title: $0.name) })
                    DatePicker("First due date", selection: $routineStart, in: (DayMath.date(DashboardRetention.earliestDay()) ?? Date())..., displayedComponents: .date)
                    CustomDropdownSelector(title: "Repeat", selection: $routineFrequency,
                        options: RepeatFrequency.allCases.filter { $0 != .never }.map { DropdownOption(value: $0, title: $0.rawValue.capitalized) })
                    Stepper("Every \(routineInterval)", value: $routineInterval, in: 1...365)
                    Button("Create routine") {
                        guard let templateID = routineTemplateID else { return }
                        store.startRoutine(templateID: templateID, name: routineName, startDay: DayMath.day(routineStart), frequency: routineFrequency, interval: routineInterval)
                        routineName = ""
                    }.disabled(routineTemplateID == nil || routineName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    ForEach(store.data.routines.filter { $0.deletedAt == nil }) { routine in
                        HStack { Text(routine.name); Spacer(); Button(routine.enabled ? "Pause" : "Resume") { store.setRoutineEnabled(routine.id, enabled: !routine.enabled) } }
                    }
                }
                Section("Archived projects") {
                    ForEach(store.data.projects.filter { $0.archivedAt != nil && $0.deletedAt == nil }) { project in
                        HStack {
                            Text(project.name)
                            Spacer()
                            Button("Restore") { store.restoreProject(project.id) }
                        }
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}

private struct TagRow: View {
    @EnvironmentObject private var store: TodoStore
    let tag: TodoTag
    @State private var name: String

    init(tag: TodoTag) {
        self.tag = tag
        _name = State(initialValue: tag.name)
    }

    var body: some View {
        HStack {
            TextField("Tag", text: $name).onSubmit { store.renameTag(tag.id, to: name) }
            Button("Save") { store.renameTag(tag.id, to: name) }
        }
        .swipeActions { Button("Delete", role: .destructive) { store.deleteTag(tag.id) } }
    }
}

struct ProjectsView: View {
    @EnvironmentObject private var store: TodoStore
    @State private var name = ""
    @State private var projectToArchive: UUID?

    var body: some View {
        NavigationStack {
            List {
                HStack {
                    TextField("New project", text: $name)
                    Button("Create") { store.addProject(name); name = "" }.disabled(name.isEmpty)
                }
                ForEach(store.projects) { project in
                    HStack {
                        NavigationLink(project.name) {
                            TaskListView(title: project.name, projectID: project.id)
                        }
                        Button { store.moveProject(project.id, by: -1) } label: { Image(systemName: "arrow.up") }
                            .accessibilityLabel("Move project \(project.name) up")
                        Button { store.moveProject(project.id, by: 1) } label: { Image(systemName: "arrow.down") }
                            .accessibilityLabel("Move project \(project.name) down")
                    }
                    .buttonStyle(.borderless)
                    .swipeActions {
                        Button("Archive") { projectToArchive = project.id }.tint(LTMTheme.accent)
                    }
                }
            }
            .navigationTitle("Projects")
            .confirmationDialog("Archive project? Its tasks will leave active views until restored in Settings.", isPresented: Binding(
                get: { projectToArchive != nil }, set: { if !$0 { projectToArchive = nil } }
            )) {
                Button("Archive project") {
                    if let projectToArchive { store.archive(projectToArchive) }
                    projectToArchive = nil
                }
            }
        }
    }
}
