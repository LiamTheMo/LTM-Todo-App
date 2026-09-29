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
                        VStack(alignment: .leading) {
                            Text(task.title)
                            Text(completion.completedAt.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .navigationTitle("History")
            }
        case .settings:
            NavigationStack {
                List {
                    Section("Your data") {
                        Text("Tasks are stored on this device. Cross-device sync arrives in a later phase.")
                        Text("Notifications need permission and a due date with a time.")
                    }
                }
                .navigationTitle("Settings")
            }
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
                Section {
                    ForEach(visible) { task in
                        TaskRow(task: task) { editing = task }
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
                .accessibilityLabel("Complete \(task.title)")
            Button(action: edit) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(task.title).foregroundStyle(.primary)
                    if let day = task.dueDay { Text("Due \(day)").font(.caption).foregroundStyle(.secondary) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 4)
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
