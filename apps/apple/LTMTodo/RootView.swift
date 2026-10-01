import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard", tasks = "Tasks", projects = "Projects", calendar = "Calendar", settings = "Settings"
    var id: Self { self }
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
                                    Label {
                                        Text(section.rawValue)
                                    } icon: {
                                        TabIcon(section: section, isSelected: selection == section)
                                    }
                                    .labelStyle(.iconOnly)
                                } else {
                                    Label {
                                        Text(section.rawValue)
                                    } icon: {
                                        TabIcon(section: section, isSelected: selection == section)
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

struct CalendarView: View {
    @EnvironmentObject private var store: TodoStore
    @State private var selectedDate = Date()
    @State private var editing: TodoTask?

    private var selectedDay: String { DayMath.day(selectedDate) }
    private var earliestDate: Date { DayMath.date(DashboardRetention.earliestDay()) ?? Calendar.current.startOfDay(for: Date()) }

    private var visibleTasks: [TodoTask] {
        store.activeTasks.filter { task in
            task.dueDay == selectedDay || task.scheduledStart.map { Calendar.current.isDate($0, inSameDayAs: selectedDate) } == true
        }.sorted { left, right in
            let leftStart = left.scheduledStart ?? .distantFuture
            let rightStart = right.scheduledStart ?? .distantFuture
            if leftStart != rightStart { return leftStart < rightStart }
            if left.dueTime != right.dueTime { return (left.dueTime ?? "") < (right.dueTime ?? "") }
            return left.title.localizedCaseInsensitiveCompare(right.title) == .orderedAscending
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    DatePicker("Date", selection: $selectedDate, in: earliestDate..., displayedComponents: .date)
                        .datePickerStyle(.graphical)
                    Button("Go to Today") { selectedDate = Date() }
                }
                Section(selectedDate.formatted(date: .complete, time: .omitted)) {
                    if visibleTasks.isEmpty {
                        ContentUnavailableView("Nothing planned", systemImage: "calendar", description: Text("Tasks due or scheduled for this day will appear here."))
                    } else {
                        ForEach(visibleTasks) { task in
                            TaskRow(task: task, subtitle: subtitle(for: task)) { editing = task }
                        }
                    }
                }
            }
            .navigationTitle("Calendar")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { editing = TodoTask(title: "", dueDay: selectedDay) } label: { Label("Add task", systemImage: "plus") }
                }
            }
            .sheet(item: $editing) { task in TaskEditorView(task: task) }
        }
    }

    private func subtitle(for task: TodoTask) -> String? {
        var details: [String] = []
        if let start = task.scheduledStart, Calendar.current.isDate(start, inSameDayAs: selectedDate) {
            let end = task.scheduledEnd.map { " – \($0.formatted(date: .omitted, time: .shortened))" } ?? ""
            details.append("Planned \(start.formatted(date: .omitted, time: .shortened))\(end)")
        }
        if task.dueDay == selectedDay { details.append(task.dueTime.map { "Due at \($0)" } ?? "Due today") }
        return details.isEmpty ? nil : details.joined(separator: " · ")
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
                    Picker("Priority", selection: $priorityFilter) {
                        Text("All").tag(-1)
                        Text("None").tag(0)
                        Text("Low").tag(1)
                        Text("Medium").tag(2)
                        Text("High").tag(3)
                    }
                    if isMaster {
                        Picker("Status", selection: $statusFilter) {
                            Text("Open").tag(0)
                            Text("Completed").tag(1)
                            Text("All statuses").tag(2)
                        }
                        Picker("Project", selection: $projectFilter) {
                            Text("All projects").tag("all")
                            Text("Inbox").tag("inbox")
                            ForEach(store.projects) { project in Text(project.name).tag(project.id.uuidString) }
                        }
                    }
                    Picker("Tag", selection: $tagFilter) {
                        Text("All tags").tag("all")
                        ForEach(store.data.tags.filter { $0.deletedAt == nil }) { tag in Text(tag.name).tag(tag.id.uuidString) }
                    }
                    Picker("Due date", selection: $dateFilter) {
                        Text("Any due date").tag("all")
                        Text("Overdue").tag("overdue")
                        Text("Due today").tag("today")
                        Text("Upcoming").tag("upcoming")
                        Text("No due date").tag("undated")
                    }
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
