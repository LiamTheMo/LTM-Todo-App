import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var store: TodoStore
    @State private var pastDays = 7
    @State private var futureDays = 28
    @State private var editing: TodoTask?

    private var dates: [String] {
        let today = DayMath.day(Date())
        return (-pastDays...futureDays).compactMap { DayMath.add($0, to: today) }
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { reader in
                ScrollView {
                    LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                        Button("Earlier days") { pastDays += 28 }
                            .padding()
                        ForEach(dates, id: \.self) { day in
                            Section {
                                dayContent(day)
                            } header: {
                                HStack {
                                    Text(day == DayMath.day(Date()) ? "TODAY" : day)
                                        .font(.caption.bold())
                                        .accessibilityAddTraits(.isHeader)
                                    Spacer()
                                }
                                .padding(.horizontal)
                                .padding(.vertical, 10)
                                .background(.regularMaterial)
                            }
                            .id(day)
                        }
                        Button("Later days") { futureDays += 28 }
                            .padding()
                    }
                }
                .onAppear { reader.scrollTo(DayMath.day(Date()), anchor: .top) }
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Today") { withAnimation { reader.scrollTo(DayMath.day(Date()), anchor: .top) } }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button { editing = TodoTask(title: "") } label: { Image(systemName: "plus") }
                            .accessibilityLabel("Add task")
                    }
                }
            }
            .navigationTitle("Dashboard")
            .sheet(item: $editing) { task in TaskEditorView(task: task) }
        }
    }

    @ViewBuilder
    private func dayContent(_ day: String) -> some View {
        let scheduled = store.activeTasks.filter { $0.scheduledStart.map { DayMath.day($0) == day } ?? false }
            .sorted { ($0.scheduledStart ?? .distantFuture) < ($1.scheduledStart ?? .distantFuture) }
        let due = store.activeTasks.filter { $0.dueDay == day }
        let overdue = day == DayMath.day(Date()) ? store.activeTasks.filter { ($0.dueDay ?? day) < day } : []
        VStack(alignment: .leading, spacing: 8) {
            if !scheduled.isEmpty {
                Text("SCHEDULED").font(.caption2.bold()).foregroundStyle(.secondary)
                ForEach(scheduled) { task in
                    TaskRow(task: task) { editing = task }
                }
            }
            if !overdue.isEmpty {
                Text("OVERDUE").font(.caption2.bold()).foregroundStyle(.red)
                ForEach(overdue) { task in TaskRow(task: task) { editing = task } }
            }
            if !due.isEmpty {
                Text("DUE").font(.caption2.bold()).foregroundStyle(.secondary)
                ForEach(due) { task in TaskRow(task: task) { editing = task } }
            }
            if scheduled.isEmpty && due.isEmpty && overdue.isEmpty {
                Text("Nothing planned").font(.caption).foregroundStyle(.secondary)
            }
            Button("Add task for this day") {
                editing = TodoTask(title: "", dueDay: day)
            }
            .font(.caption)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Divider() }
    }
}
