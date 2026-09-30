import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var store: TodoStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var windowStart = 0
    @State private var editing: TodoTask?
    private let windowLength = 56
    private let windowStep = 28

    private var dates: [String] {
        let today = DayMath.day(Date())
        return (windowStart..<(windowStart + windowLength)).compactMap { DayMath.add($0, to: today) }
    }
    private var overdueTasks: [TodoTask] {
        let today = DayMath.day(Date())
        return store.activeTasks.filter { $0.dueDay.map { $0 < today } ?? false }
            .sorted { left, right in
                if left.dueDay != right.dueDay { return (left.dueDay ?? "") < (right.dueDay ?? "") }
                return left.sortKey == right.sortKey ? left.id.uuidString < right.id.uuidString : left.sortKey < right.sortKey
            }
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { reader in
                ScrollView {
                    LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                        Section {
                            if overdueTasks.isEmpty {
                                Text("Nothing overdue")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal)
                                    .padding(.vertical, 14)
                                    .overlay(alignment: .bottom) { Divider() }
                            } else {
                                ForEach(overdueTasks) { task in TaskRow(task: task) { editing = task } }
                            }
                        } header: {
                            HStack {
                                Text("OVERDUE").font(.caption.bold()).foregroundStyle(Color.accentColor)
                                    .accessibilityAddTraits(.isHeader)
                                Spacer()
                            }
                            .padding(.horizontal)
                            .padding(.vertical, 10)
                            .background(.regularMaterial)
                        }
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
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Today") {
                            windowStart = 0
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
        VStack(alignment: .leading, spacing: 8) {
            if !scheduled.isEmpty {
                Text("SCHEDULED").font(.caption2.bold()).foregroundStyle(.secondary).accessibilityAddTraits(.isHeader)
                ForEach(scheduled) { task in
                    TaskRow(task: task) { editing = task }
                }
            }
            if !due.isEmpty {
                Text("DUE").font(.caption2.bold()).foregroundStyle(.secondary).accessibilityAddTraits(.isHeader)
                ForEach(due) { task in TaskRow(task: task) { editing = task } }
            }
            if scheduled.isEmpty && due.isEmpty {
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
