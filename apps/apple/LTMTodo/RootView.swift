import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard", inbox = "Inbox", tasks = "Tasks", projects = "Projects", history = "History", settings = "Settings"
    var id: Self { self }
    var icon: String {
        switch self {
        case .dashboard: "rectangle.grid.1x2"
        case .inbox: "tray"
        case .tasks: "checkmark.circle"
        case .projects: "folder"
        case .history: "clock.arrow.circlepath"
        case .settings: "gearshape"
        }
    }
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
                            Label(section.rawValue, systemImage: section.icon)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(selection == section ? Color.orange : Color.primary)
                        .accessibilityAddTraits(selection == section ? .isSelected : [])
                    }
                    .navigationTitle("LTM Todo")
                } detail: { destination(for: selection) }
            } else {
                TabView(selection: $selection) {
                    ForEach(AppSection.allCases) { section in
                        destination(for: section)
                            .tabItem { Label(section.rawValue, systemImage: section.icon) }
                            .tag(section)
                    }
                }
            }
        }
        .tint(.orange)
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
        case .inbox: TaskListView(title: "Inbox", projectID: nil, inboxOnly: true)
        case .tasks: TaskListView(title: "Tasks", projectID: nil, inboxOnly: false)
        case .projects: ProjectsView()
        case .history:
            NavigationStack {
                List(store.data.completions.reversed()) { completion in
                    if let task = store.data.tasks.first(where: { $0.id == completion.taskID }) {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(task.title)
                                Text(completion.completedAt.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if store.data.completions.last(where: { $0.taskID == completion.taskID })?.id == completion.id {
                                Button("Undo") { store.undoCompletion(completion.id) }
                            }
                        }
                    }
                }
                .navigationTitle("History")
            }
        case .settings: SettingsView()
        }
    }
}

struct TaskListView: View {
    @EnvironmentObject private var store: TodoStore
    let title: String
    let projectID: UUID?
    let inboxOnly: Bool
    @State private var quickTitle = ""
    @State private var query = ""
    @State private var editing: TodoTask?
    @State private var priorityFilter = -1
    @State private var sectionName = ""

    private var visible: [TodoTask] {
        store.activeTasks.filter { task in
            (inboxOnly ? task.projectID == nil : (projectID == nil || task.projectID == projectID)) &&
            (query.isEmpty || task.title.localizedCaseInsensitiveContains(query) || task.notes.localizedCaseInsensitiveContains(query)) &&
            (priorityFilter < 0 || task.priority == priorityFilter)
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
                if !inboxOnly {
                    Picker("Priority", selection: $priorityFilter) {
                        Text("All").tag(-1)
                        Text("None").tag(0)
                        Text("Low").tag(1)
                        Text("Medium").tag(2)
                        Text("High").tag(3)
                    }
                }
                if let projectID {
                    Section("Project tasks") {
                        ForEach(visible.filter { $0.sectionID == nil }) { task in TaskRow(task: task) { editing = task } }
                    }
                    ForEach(store.data.sections.filter { $0.projectID == projectID && $0.deletedAt == nil }) { section in
                        Section(section.name) {
                            ForEach(visible.filter { $0.sectionID == section.id }) { task in
                                TaskRow(task: task) { editing = task }
                            }
                            Button("Delete section", role: .destructive) { store.deleteSection(section.id) }
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
    let edit: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button { store.complete(task.id) } label: { Image(systemName: "circle").font(.title3) }
                .disabled(store.activeTasks.contains(where: { $0.parentTaskID == task.id }))
                .accessibilityLabel(store.activeTasks.contains(where: { $0.parentTaskID == task.id }) ? "Finish subtasks before completing \(task.title)" : "Complete \(task.title)")
            Button(action: edit) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(task.title).foregroundStyle(.primary)
                    if let day = task.dueDay { Text("Due \(day)").font(.caption).foregroundStyle(.secondary) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, task.parentTaskID == nil ? 0 : 16)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 4)
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

    var body: some View {
        NavigationStack {
            List {
                HStack {
                    TextField("New project", text: $name)
                    Button("Create") { store.addProject(name); name = "" }.disabled(name.isEmpty)
                }
                ForEach(store.projects) { project in
                    NavigationLink(project.name) {
                        TaskListView(title: project.name, projectID: project.id, inboxOnly: false)
                    }
                    .swipeActions {
                        Button("Archive") { store.archive(project.id) }.tint(.orange)
                    }
                }
            }
            .navigationTitle("Projects")
        }
    }
}
