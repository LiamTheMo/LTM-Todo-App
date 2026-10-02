import SwiftUI

struct CalendarTimedItem: Identifiable {
    let id: String
    let title: String
    let caption: String
    let start: Date
    let end: Date
    let color: Color
    var column = 0
    var columnCount = 1
}

struct CalendarDayTimeline: View {
    let day: Date
    let items: [CalendarTimedItem]
    private let hourHeight: CGFloat = 56
    private let labelWidth: CGFloat = 58

    private var laidOutItems: [CalendarTimedItem] {
        let sorted = items.sorted {
            if $0.start != $1.start { return $0.start < $1.start }
            if $0.end != $1.end { return $0.end < $1.end }
            return $0.id < $1.id
        }
        var clusters: [[CalendarTimedItem]] = []
        var current: [CalendarTimedItem] = []
        var clusterEnd: Date?
        for item in sorted {
            if !current.isEmpty, let currentEnd = clusterEnd, item.start >= currentEnd {
                clusters.append(current)
                current = []
                clusterEnd = nil
            }
            current.append(item)
            if let currentEnd = clusterEnd {
                if item.end > currentEnd { clusterEnd = item.end }
            } else {
                clusterEnd = item.end
            }
        }
        if !current.isEmpty { clusters.append(current) }
        return clusters.flatMap(layoutCluster)
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    GeometryReader { geometry in
                        ZStack(alignment: .topLeading) {
                            VStack(spacing: 0) {
                                ForEach(0..<24, id: \.self) { hour in
                                    HStack(alignment: .top, spacing: 8) {
                                        Text(hourDate(hour).formatted(date: .omitted, time: .shortened))
                                            .font(.caption2).foregroundStyle(.secondary)
                                            .frame(width: labelWidth, alignment: .trailing)
                                            .id(hour)
                                        Rectangle().fill(Color.secondary.opacity(0.22)).frame(height: 1).padding(.top, 8)
                                    }
                                    .frame(height: hourHeight, alignment: .top)
                                }
                            }

                            ForEach(laidOutItems) { item in
                                let startMinute = minuteOfDay(item.start)
                                let endMinute = max(startMinute + 30, min(24 * 60, minuteOfDay(item.end)))
                                let y = CGFloat(startMinute) / 60 * hourHeight
                                let height = max(34, CGFloat(endMinute - startMinute) / 60 * hourHeight)
                                let availableWidth = max(120, geometry.size.width - labelWidth - 12)
                                let gap: CGFloat = 4
                                let cardWidth = max(72, (availableWidth - CGFloat(item.columnCount - 1) * gap) / CGFloat(item.columnCount))
                                eventCard(item)
                                    .frame(width: cardWidth, height: height, alignment: .topLeading)
                                    .offset(x: labelWidth + 8 + CGFloat(item.column) * (cardWidth + gap), y: y)
                                    .zIndex(1)
                            }

                            if Calendar.current.isDate(day, inSameDayAs: context.date) {
                                let minute = minuteOfDay(context.date)
                                HStack(spacing: 5) {
                                    Text(context.date.formatted(date: .omitted, time: .shortened))
                                        .font(.caption2.weight(.semibold)).foregroundStyle(.red)
                                        .frame(width: labelWidth, alignment: .trailing)
                                    Circle().fill(.red).frame(width: 7, height: 7)
                                    Rectangle().fill(.red).frame(height: 2)
                                }
                                .offset(y: CGFloat(minute) / 60 * hourHeight - 5)
                                .zIndex(5)
                                .accessibilityElement(children: .ignore)
                                .accessibilityLabel("Current time, \(context.date.formatted(date: .omitted, time: .shortened))")
                            }
                        }
                        .frame(height: hourHeight * 24)
                    }
                    .frame(height: hourHeight * 24)
                }
                .frame(height: 420)
                .onAppear {
                    let hour = Calendar.current.isDate(day, inSameDayAs: Date())
                        ? max(0, Calendar.current.component(.hour, from: Date()) - 1) : 8
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        proxy.scrollTo(hour, anchor: .top)
                    }
                }
            }
        }
        .accessibilityIdentifier("calendar-day-timeline")
    }

    private func eventCard(_ item: CalendarTimedItem) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(item.title).font(.caption.weight(.semibold)).lineLimit(2)
            Text(item.caption).font(.caption2).lineLimit(1)
        }
        .foregroundStyle(.primary)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(item.color.opacity(0.17), in: RoundedRectangle(cornerRadius: 7))
        .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(item.color).frame(width: 4) }
        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(item.color.opacity(0.35), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.title), \(item.caption)")
    }

    private func hourDate(_ hour: Int) -> Date {
        Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
    }

    private func minuteOfDay(_ date: Date) -> Int {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        return max(0, min(24 * 60, (components.hour ?? 0) * 60 + (components.minute ?? 0)))
    }

    private func layoutCluster(_ cluster: [CalendarTimedItem]) -> [CalendarTimedItem] {
        var columnEnds: [Date] = []
        var positioned: [CalendarTimedItem] = []
        for var item in cluster {
            let column = columnEnds.firstIndex(where: { $0 <= item.start }) ?? columnEnds.count
            if column == columnEnds.count { columnEnds.append(item.end) }
            else { columnEnds[column] = item.end }
            item.column = column
            positioned.append(item)
        }
        for index in positioned.indices { positioned[index].columnCount = max(1, columnEnds.count) }
        return positioned
    }
}
