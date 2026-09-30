import SwiftUI

private struct DashboardOccurrence: Identifiable {
    let task: TodoTask
    let completion: TodoCompletion?
    let completedAt: Date

    var id: String { completion?.id.uuidString ?? "legacy-\(task.id.uuidString)" }
}

private struct DashboardSchedule: Identifiable {
    let task: TodoTask
    let completion: TodoCompletion?
    let start: Date

    var id: String { completion?.id.uuidString ?? "task-\(task.id.uuidString)" }
}

struct DashboardView: View {
    @EnvironmentObject private var store: TodoStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var windowStart = 1 - DashboardRetention.days
    @State private var editing: TodoTask?
    @State private var didInitialScroll = false
    @State private var isShifting = false
    private let windowLength = 84
    private let windowStep = 28

    private var today: String { store.localToday }
    private var earliestOffset: Int { 1 - DashboardRetention.days }
    private var dates: [String] {
        (windowStart..<(windowStart + windowLength)).compactMap { DayMath.add($0, to: today) }
    }
    private func overdueDueSubtitle(for task: TodoTask) -> String {
        guard let dueDay = task.dueDay,
              let dueDate = DayMath.date(dueDay),
              let todayDate = DayMath.date(today) else { return "Overdue" }
        let daysAgo = Calendar.current.dateComponents([.day], from: dueDate, to: todayDate).day ?? 0
        let unit = daysAgo == 1 ? "day" : "days"
        return daysAgo > 0 ? "Due \(daysAgo) \(unit) ago" : "Overdue"
    }

    private var overdueTasks: [TodoTask] {
        store.activeTasks.filter { $0.dueDay.map { $0 < today && $0 >= DashboardRetention.earliestDay(today: today) } ?? false }
            .sorted { left, right in
                if left.dueDay != right.dueDay { return (left.dueDay ?? "") < (right.dueDay ?? "") }
                return left.sortKey == right.sortKey ? left.id.uuidString < right.id.uuidString : left.sortKey < right.sortKey
            }
    }
    private var tasksByID: [UUID: TodoTask] { Dictionary(uniqueKeysWithValues: store.unarchivedTasks.map { ($0.id, $0) }) }
    private var dueByDay: [String: [TodoTask]] {
        var result: [String: [TodoTask]] = [:]
        for task in store.activeTasks {
            guard let day = task.dueDay, day >= DashboardRetention.earliestDay(today: today) else { continue }
            result[day, default: []].append(task)
        }
        return result
    }
    private var schedulesByDay: [String: [DashboardSchedule]] {
        var result: [String: [DashboardSchedule]] = [:]
        for task in store.activeTasks {
            guard let start = task.scheduledStart else { continue }
            let day = DayMath.day(start)
            guard day >= DashboardRetention.earliestDay(today: today) else { continue }
            result[day, default: []].append(DashboardSchedule(task: task, completion: nil, start: start))
        }
        for completion in store.data.completions {
            guard let start = completion.scheduledStart else { continue }
            let day = DayMath.day(start)
            guard day >= DashboardRetention.earliestDay(today: today), day <= today,
                  let task = tasksByID[completion.taskID] else { continue }
            result[day, default: []].append(DashboardSchedule(task: task, completion: completion, start: start))
        }
        return result.mapValues { $0.sorted { $0.start < $1.start } }
    }
    private var completionsByDay: [String: [DashboardOccurrence]] {
        var result: [String: [DashboardOccurrence]] = [:]
        let recordedTaskIDs = Set(store.data.completions.map(\.taskID))
        for completion in store.data.completions {
            guard let task = tasksByID[completion.taskID] else { continue }
            let day = completion.occurrenceDay ?? DayMath.day(completion.completedAt)
            guard day >= DashboardRetention.earliestDay(today: today) else { continue }
            result[day, default: []].append(DashboardOccurrence(task: task, completion: completion, completedAt: completion.completedAt))
        }
        for task in store.unarchivedTasks where task.completedAt != nil && !recordedTaskIDs.contains(task.id) {
            guard let completedAt = task.completedAt else { continue }
            let day = task.dueDay ?? DayMath.day(completedAt)
            guard day >= DashboardRetention.earliestDay(today: today) else { continue }
            result[day, default: []].append(DashboardOccurrence(task: task, completion: nil, completedAt: completedAt))
        }
        return result.mapValues { $0.sorted { $0.completedAt < $1.completedAt } }
    }

    var body: some View {
        let schedules = schedulesByDay
        let dues = dueByDay
        let completions = completionsByDay
        NavigationStack {
            VStack(spacing: 0) {
                overduePanel
                ScrollViewReader { reader in
                    ScrollView {
                        LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                            Button("Earlier days ↑") {
                                if let first = dates.first { shiftWindow(by: -windowStep, preserving: first, reader: reader) }
                            }
                            .font(.caption)
                            .padding(.vertical, 10)
                            .disabled(windowStart <= earliestOffset)
                            ForEach(dates, id: \.self) { day in
                                let daySchedules = schedules[day] ?? []
                                let dayDue = dues[day] ?? []
                                let dayCompletions = completions[day] ?? []
                                Section {
                                    dayContent(day, schedules: daySchedules, due: dayDue, completions: dayCompletions)
                                } header: {
                                    dayHeader(day)
                                }
                                .id(day)
                                .onAppear { extendWindowIfNeeded(day, reader: reader) }
                            }
                            Button("Later days ↓") {
                                if let last = dates.last { shiftWindow(by: windowStep, preserving: last, reader: reader) }
                            }
                            .font(.caption)
                            .padding(.vertical, 10)
                        }
                    }
                    .onAppear {
                        DispatchQueue.main.async {
                            reader.scrollTo(today, anchor: .top)
                            didInitialScroll = true
                        }
                    }
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Today") { returnToToday(reader) }
                        }
                        ToolbarItem(placement: .primaryAction) {
                            Button { editing = TodoTask(title: "") } label: { Image(systemName: "plus") }
                                .accessibilityLabel("Add task")
                        }
                    }
                }
            }
            .navigationTitle("Dashboard")
            .sheet(item: $editing) { task in TaskEditorView(task: task) }
        }
    }

    private var overduePanel: some View {
        VStack(spacing: 0) {
            HStack {
                Text("OVERDUE")
                    .font(.caption.bold())
                    .foregroundStyle(Color(red: 0.72, green: 0.29, blue: 0.21))
                    .accessibilityAddTraits(.isHeader)
                Spacer()
            }
            .padding(.horizontal)
            .padding(.vertical, 10)
            .background(Color(red: 1.0, green: 0.95, blue: 0.93))
            if overdueTasks.isEmpty {
                Text("Nothing overdue")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal)
                    .padding(.vertical, 12)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(overdueTasks) { task in TaskRow(task: task, completion: nil, subtitle: overdueDueSubtitle(for: task)) { editing = task } }
                    }
                }
                .frame(maxHeight: 200)
            }
        }
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(red: 0.90, green: 0.77, blue: 0.72)))
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 8)
    }

    private func dayHeader(_ day: String) -> some View {
        let past = day < today
        return HStack {
            Text(day == today ? "TODAY" :
                day == DayMath.add(1, to: today) ? "TOMORROW" : day)
                .font(.caption.bold())
                .foregroundStyle(past ? Color.secondary : Color.primary)
                .accessibilityAddTraits(.isHeader)
                .accessibilityLabel(day)
            Spacer()
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(past ? Color.secondary.opacity(0.08) : Color.primary.opacity(0.03))
    }

    @ViewBuilder
    private func dayContent(_ day: String, schedules: [DashboardSchedule], due: [TodoTask], completions: [DashboardOccurrence]) -> some View {
        let past = day < today
        let scheduledCompletionIDs = Set(schedules.compactMap { $0.completion?.id })
        let completedTasks = completions.filter { item in
            guard let completion = item.completion else { return true }
            return !scheduledCompletionIDs.contains(completion.id)
        }
        VStack(alignment: .leading, spacing: 8) {
            if !schedules.isEmpty {
                Text("SCHEDULED").font(.caption2.bold()).foregroundStyle(.secondary).accessibilityAddTraits(.isHeader)
                ForEach(schedules) { item in
                    TaskRow(task: item.task, completion: item.completion) { editing = item.task }
                }
            }
            if !due.isEmpty {
                Text("DUE").font(.caption2.bold()).foregroundStyle(.secondary).accessibilityAddTraits(.isHeader)
                ForEach(due) { task in TaskRow(task: task) { editing = task } }
            }
            if !completedTasks.isEmpty {
                Text("COMPLETED").font(.caption2.bold()).foregroundStyle(.secondary).accessibilityAddTraits(.isHeader)
                ForEach(completedTasks) { item in
                    TaskRow(task: item.task, completion: item.completion) { editing = item.task }
                }
            }
            if schedules.isEmpty && due.isEmpty && completedTasks.isEmpty {
                HStack {
                    Text(past ? "No completed items" : "Nothing planned").font(.caption).foregroundStyle(.secondary)
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
        .background(past ? Color.secondary.opacity(0.035) : Color.clear)
        .overlay(alignment: .bottom) { Divider() }
    }

    private func extendWindowIfNeeded(_ day: String, reader: ScrollViewProxy) {
        guard didInitialScroll, !isShifting else { return }
        if day == dates.first && windowStart > earliestOffset { shiftWindow(by: -windowStep, preserving: day, reader: reader) }
        else if day == dates.last { shiftWindow(by: windowStep, preserving: day, reader: reader) }
    }

    private func shiftWindow(by amount: Int, preserving day: String, reader: ScrollViewProxy) {
        guard !isShifting else { return }
        let nextStart = amount < 0 ? max(windowStart + amount, earliestOffset) : windowStart + amount
        guard nextStart != windowStart else { return }
        isShifting = true
        windowStart = nextStart
        DispatchQueue.main.async {
            reader.scrollTo(day, anchor: amount < 0 ? .bottom : .top)
            DispatchQueue.main.async { isShifting = false }
        }
    }

    private func returnToToday(_ reader: ScrollViewProxy) {
        isShifting = true
        windowStart = earliestOffset
        DispatchQueue.main.async {
            if reduceMotion { reader.scrollTo(today, anchor: .top) }
            else { withAnimation { reader.scrollTo(today, anchor: .top) } }
            didInitialScroll = true
            DispatchQueue.main.async { isShifting = false }
        }
    }
}
