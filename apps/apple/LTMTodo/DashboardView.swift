import SwiftUI

struct DashboardDay: Identifiable {
    let id = UUID()
    let label: String
    let date: String
    let scheduled: [String]
    let due: [String]
}

struct DashboardView: View {
    private let previewDays = [
        DashboardDay(label: "TODAY", date: "SEP 29", scheduled: ["9:00 AM  Plan the day", "4:00 PM  Focus block"], due: ["Set up LTM Todo foundation"]),
        DashboardDay(label: "TOMORROW", date: "SEP 30", scheduled: [], due: ["Review upcoming work"]),
        DashboardDay(label: "THURSDAY", date: "OCT 1", scheduled: ["2:00 PM  Project time"], due: [])
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                    ForEach(previewDays) { day in
                        Section {
                            DayContent(day: day)
                        } header: {
                            HStack {
                                Text(day.label).font(.caption.bold())
                                Spacer()
                                Text(day.date).font(.caption.monospacedDigit())
                            }
                            .padding(.horizontal)
                            .padding(.vertical, 10)
                            .background(.background)
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
            .navigationTitle("Dashboard")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button(action: {}) { Image(systemName: "plus") }
                        .accessibilityLabel("Add task")
                }
            }
        }
    }
}

private struct DayContent: View {
    let day: DashboardDay

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if day.scheduled.isEmpty && day.due.isEmpty {
                Text("Nothing planned").foregroundStyle(.secondary)
            }
            if !day.scheduled.isEmpty {
                Text("SCHEDULED").font(.caption2.bold()).foregroundStyle(.secondary)
                ForEach(day.scheduled, id: \.self) { Text($0).frame(maxWidth: .infinity, alignment: .leading) }
            }
            if !day.due.isEmpty {
                Text("DUE").font(.caption2.bold()).foregroundStyle(.secondary)
                ForEach(day.due, id: \.self) { item in
                    Label(item, systemImage: "circle").frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background)
        .overlay(alignment: .bottom) { Divider() }
    }
}
