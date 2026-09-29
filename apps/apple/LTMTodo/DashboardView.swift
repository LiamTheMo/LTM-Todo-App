import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var store: TodoStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var windowStart = -7
    @State private var initialScrollDone = false
    @State private var editing: TodoTask?
    private let windowLength = 56
    private let windowStep = 28

    private var dates: [String] {
        let today = DayMath.day(Date())
        return (windowStart..<(windowStart + windowLength)).compactMap { DayMath.add($0, to: today) }
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { reader in
                ScrollView {
                    LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                        Button("Earlier days") {
                            let anchor = dates.first
                            windowStart -= windowStep
                            if let anchor { DispatchQueue.main.async { reader.scrollTo(anchor, anchor: .top) } }
                        }
                            .padding()
                        ForEach(dates, id: \.self) { day in
                            Section {
                                dayContent(day)
                            } header: {
                                HStack {
                                    Text(day == DayMath.day(Date()) ? "TODAY" :
                                        day == DayMath.add(1, to: DayMath.day(Date())) ? "TOMORROW" : day)
                                        .font(.caption.bold())
                                        .accessibilityAddTraits(.isHeader)
                                        .accessibilityLabel(day)
                                    Spacer()
                                }
                                .padding(.horizontal)
                                .padding(.vertical, 10)
                                .background(.regularMaterial)
                            }
                            .id(day)
                        }
                        Button("Later days") {
                            let anchor = dates.last
                            windowStart += windowStep
                            if let anchor { DispatchQueue.main.async { reader.scrollTo(anchor, anchor: .bottom) } }
                        }
                            .padding()
                    }
                }
                .onAppear {
                    guard !initialScrollDone else { return }
                    initialScrollDone = true
                    reader.scrollTo(DayMath.day(Date()), anchor: .top)
                }
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Today") {
                            windowStart = -7
                            DispatchQueue.main.async {
                                if reduceMotion { reader.scrollTo(DayMath.day(Date()), anchor: .top) }
                                else { withAnimation { reader.scrollTo(DayMath.day(Date()), anchor: .top) } }
                            }
                        }
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
                Text("SCHEDULED").font(.caption2.bold()).foregroundStyle(.secondary).accessibilityAddTraits(.isHeader)
                ForEach(scheduled) { task in
                    TaskRow(task: task) { editing = task }
                }
            }
            if !overdue.isEmpty {
                Text("OVERDUE").font(.caption2.bold()).foregroundStyle(.red).accessibilityAddTraits(.isHeader)
                ForEach(overdue) { task in TaskRow(task: task) { editing = task } }
            }
            if !due.isEmpty {
                Text("DUE").font(.caption2.bold()).foregroundStyle(.secondary).accessibilityAddTraits(.isHeader)
                ForEach(due) { task in TaskRow(task: task) { editing = task } }
            }
            if scheduled.isEmpty && due.isEmpty && overdue.isEmpty {
                HStack {
                    Text("Nothing planned").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Add") { editing = TodoTask(title: "", dueDay: day) }.font(.caption)
                }
            } else {
                Button("Add task for this day") {
                    editing = TodoTask(title: "", dueDay: day)
                }
                .font(.caption)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Divider() }
    }
}
