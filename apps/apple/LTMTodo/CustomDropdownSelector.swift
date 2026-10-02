import SwiftUI

struct DropdownOption<Value: Hashable>: Identifiable {
    let value: Value
    let title: String
    var detail: String? = nil

    var id: Value { value }
}

struct CustomDropdownSelector<Value: Hashable>: View {
    let title: String
    @Binding var selection: Value
    let options: [DropdownOption<Value>]
    var accessibilityID: String? = nil
    @State private var isPresented = false

    private var selectedOption: DropdownOption<Value>? { options.first { $0.value == selection } }

    var body: some View {
        SelectorField(title: title, value: selectedOption?.title ?? "Choose…", action: { isPresented = true })
        .accessibilityIdentifier(accessibilityID ?? "selector-\(title.lowercased().replacingOccurrences(of: " ", with: "-"))")
        .accessibilityValue(selectedOption?.title ?? "Choose")
        .popover(isPresented: $isPresented, attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 10) {
                Text(title)
                    .font(.headline)
                    .padding(.horizontal, 4)
                ScrollView {
                    VStack(spacing: 4) {
                        ForEach(options) { option in
                            Button {
                                selection = option.value
                                isPresented = false
                            } label: {
                                HStack(spacing: 10) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(option.title).foregroundStyle(.primary)
                                        if let detail = option.detail {
                                            Text(detail).font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer(minLength: 8)
                                    if option.value == selection {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundStyle(LTMTheme.accent)
                                    }
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(option.value == selection ? LTMTheme.accent.opacity(0.12) : .clear,
                                            in: RoundedRectangle(cornerRadius: 10))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(option.value == selection ? .isSelected : [])
                        }
                    }
                }
            }
            .padding(14)
            .frame(minWidth: 250, idealWidth: 300, maxWidth: 340)
            .frame(maxHeight: 360)
            .background(.regularMaterial)
            .presentationCompactAdaptation(.popover)
        }
    }
}

/// App-owned date and time controls keep their trigger rows the same size and style
/// as the data selectors, without exposing the platform DatePicker wheel/calendar UI.
struct CustomDateSelector: View {
    let title: String
    @Binding var selection: Date
    var minimumDate: Date? = nil
    var maximumDate: Date? = nil
    var accessibilityID: String? = nil
    @State private var isPresented = false
    @State private var displayedMonth = Calendar.current.dateInterval(of: .month, for: Date())?.start ?? Date()

    private var calendar: Calendar { Calendar.current }
    private var monthDates: [Date] {
        guard let monthStart = calendar.dateInterval(of: .month, for: displayedMonth)?.start else { return [] }
        let weekdayOffset = (calendar.component(.weekday, from: monthStart) - calendar.firstWeekday + 7) % 7
        guard let gridStart = calendar.date(byAdding: .day, value: -weekdayOffset, to: monthStart) else { return [] }
        return (0..<42).compactMap { calendar.date(byAdding: .day, value: $0, to: gridStart) }
    }
    private var weekdaySymbols: [String] {
        let symbols = calendar.veryShortStandaloneWeekdaySymbols
        let start = max(0, calendar.firstWeekday - 1)
        return Array(symbols[start...] + symbols[..<start])
    }

    var body: some View {
        SelectorField(title: title, value: selection.formatted(.dateTime.month(.abbreviated).day().year()), action: {
            displayedMonth = calendar.dateInterval(of: .month, for: selection)?.start ?? selection
            isPresented = true
        })
        .accessibilityIdentifier(accessibilityID ?? "date-selector-\(title.lowercased().replacingOccurrences(of: " ", with: "-"))")
        .accessibilityValue(selection.formatted(date: .complete, time: .omitted))
        .popover(isPresented: $isPresented, attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) {
            VStack(spacing: 14) {
                HStack {
                    Button { shiftMonth(-1) } label: { Image(systemName: "chevron.left") }
                        .disabled(!canNavigate(to: -1))
                        .accessibilityLabel("Previous month")
                    Spacer()
                    Text(displayedMonth.formatted(.dateTime.month(.wide).year())).font(.headline)
                    Spacer()
                    Button { shiftMonth(1) } label: { Image(systemName: "chevron.right") }
                        .disabled(!canNavigate(to: 1))
                        .accessibilityLabel("Next month")
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 6) {
                    ForEach(weekdaySymbols, id: \.self) { symbol in
                        Text(symbol).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity).accessibilityHidden(true)
                    }
                    ForEach(monthDates, id: \.self) { date in
                        let isSelected = calendar.isDate(date, inSameDayAs: selection)
                        let isDisabled = isOutsideBounds(date)
                        Button {
                            let time = calendar.dateComponents([.hour, .minute, .second], from: selection)
                            selection = calendar.date(bySettingHour: time.hour ?? 0, minute: time.minute ?? 0,
                                second: time.second ?? 0, of: date) ?? date
                            isPresented = false
                        } label: {
                            Text(date.formatted(.dateTime.day()))
                                .font(.subheadline.weight(isSelected ? .bold : .regular))
                                .foregroundStyle(isSelected ? Color.white : Color.primary)
                                .frame(maxWidth: .infinity, minHeight: 36)
                                .background(isSelected ? LTMTheme.accent : .clear, in: Circle())
                        }
                        .buttonStyle(.plain)
                        .disabled(isDisabled)
                        .opacity(isDisabled ? 0.3 : 1)
                        .accessibilityLabel(date.formatted(date: .complete, time: .omitted))
                        .accessibilityAddTraits(isSelected ? .isSelected : [])
                    }
                }
                HStack {
                    Button("Today") {
                        let today = calendar.startOfDay(for: Date())
                        guard !isOutsideBounds(today) else { return }
                        let time = calendar.dateComponents([.hour, .minute, .second], from: selection)
                        selection = calendar.date(bySettingHour: time.hour ?? 0, minute: time.minute ?? 0,
                            second: time.second ?? 0, of: today) ?? today
                        displayedMonth = calendar.dateInterval(of: .month, for: today)?.start ?? today
                        isPresented = false
                    }
                    .disabled(isOutsideBounds(calendar.startOfDay(for: Date())))
                    Spacer()
                    Button("Done") { isPresented = false }.fontWeight(.semibold)
                }
            }
            .padding(16)
            .frame(width: 320)
            .background(.regularMaterial)
            .presentationCompactAdaptation(.popover)
        }
    }

    private func isOutsideBounds(_ date: Date) -> Bool {
        let day = calendar.startOfDay(for: date)
        if let minimumDate, day < calendar.startOfDay(for: minimumDate) { return true }
        if let maximumDate, day > calendar.startOfDay(for: maximumDate) { return true }
        return false
    }

    private func canNavigate(to offset: Int) -> Bool {
        guard let target = calendar.date(byAdding: .month, value: offset, to: displayedMonth) else { return false }
        guard let interval = calendar.dateInterval(of: .month, for: target) else { return false }
        if let minimumDate, interval.end <= calendar.startOfDay(for: minimumDate) { return false }
        if let maximumDate, interval.start > calendar.startOfDay(for: maximumDate) { return false }
        return true
    }

    private func shiftMonth(_ offset: Int) {
        guard canNavigate(to: offset),
              let date = calendar.date(byAdding: .month, value: offset, to: displayedMonth),
              let monthStart = calendar.dateInterval(of: .month, for: date)?.start else { return }
        displayedMonth = monthStart
    }
}

struct CustomTimeSelector: View {
    let title: String
    @Binding var selection: Date
    var minimumDate: Date? = nil
    var accessibilityID: String? = nil
    @State private var isPresented = false

    private var calendar: Calendar { Calendar.current }
    private var hour24: Int { calendar.component(.hour, from: selection) }
    private var minute: Int { calendar.component(.minute, from: selection) }
    private var hour12: Int { let hour = hour24 % 12; return hour == 0 ? 12 : hour }
    private var meridiem: String { hour24 < 12 ? "am" : "pm" }
    private var timeCaption: String { String(format: "%d:%02d%@", hour12, minute, meridiem) }

    var body: some View {
        SelectorField(title: title, value: timeCaption, action: {
            isPresented = true
        })
        .accessibilityIdentifier(accessibilityID ?? "time-selector-\(title.lowercased().replacingOccurrences(of: " ", with: "-"))")
        .accessibilityValue(selection.formatted(date: .omitted, time: .shortened))
        .popover(isPresented: $isPresented, attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 16) {
                Text(title).font(.headline)
                HStack(spacing: 12) {
                    timeStepper(value: String(format: "%02d", hour12), label: "Hour") { stepHour($0) }
                    Text(":").font(.title2.weight(.semibold)).padding(.top, 18)
                    timeStepper(value: String(format: "%02d", minute), label: "Minute") { stepMinute($0) }
                    VStack(spacing: 6) {
                        Text("AM/PM").font(.caption2).foregroundStyle(.secondary)
                        Button(meridiem.uppercased()) { toggleMeridiem() }
                            .font(.headline.weight(.semibold))
                            .frame(width: 62, height: 44)
                            .background(LTMTheme.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
                    }
                }
                HStack {
                    Spacer()
                    Button("Done") { isPresented = false }.fontWeight(.semibold)
                }
            }
            .padding(16)
            .frame(width: 300)
            .background(.regularMaterial)
            .presentationCompactAdaptation(.popover)
        }
    }

    private func timeStepper(value: String, label: String, change: @escaping (Int) -> Void) -> some View {
        VStack(spacing: 6) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Button { change(1) } label: { Image(systemName: "chevron.up") }
                .accessibilityLabel("Increase \(label.lowercased())")
            Text(value).font(.title2.monospacedDigit().weight(.semibold)).frame(width: 52, height: 36)
                .accessibilityLabel("\(label) \(value)")
            Button { change(-1) } label: { Image(systemName: "chevron.down") }
                .accessibilityLabel("Decrease \(label.lowercased())")
        }
        .frame(maxWidth: .infinity)
    }

    private func stepHour(_ offset: Int) {
        let nextHour12 = (hour12 - 1 + offset + 12) % 12 + 1
        let candidate = nextHour12 % 12 + (meridiem == "pm" ? 12 : 0)
        updateTime(hour: candidate, minute: minute)
    }

    private func stepMinute(_ offset: Int) {
        let totalMinutes = (hour24 * 60 + minute + offset + 24 * 60) % (24 * 60)
        updateTime(hour: totalMinutes / 60, minute: totalMinutes % 60)
    }

    private func toggleMeridiem() {
        updateTime(hour: (hour24 + 12) % 24, minute: minute)
    }

    private func updateTime(hour: Int, minute: Int) {
        guard let candidate = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: selection) else { return }
        if let minimumDate, candidate < minimumDate { return }
        selection = candidate
    }
}

private struct SelectorField: View {
    let title: String
    let value: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text(title).foregroundStyle(.primary)
                Spacer(minLength: 8)
                Text(value).foregroundStyle(.secondary).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption.weight(.semibold)).foregroundStyle(LTMTheme.accent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct DropdownMenuAction: Identifiable {
    let id: String
    let title: String
    let systemImage: String
    let action: () -> Void
}

struct CustomDropdownMenu: View {
    let label: String
    let actions: [DropdownMenuAction]
    @State private var isPresented = false

    var body: some View {
        Button { isPresented = true } label: {
            Label(label, systemImage: "plus")
        }
        .accessibilityIdentifier("calendar-add-menu")
        .popover(isPresented: $isPresented, attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 5) {
                ForEach(actions) { item in
                    Button {
                        isPresented = false
                        item.action()
                    } label: {
                        Label(item.title, systemImage: item.systemImage)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(10)
            .frame(minWidth: 220, idealWidth: 260, maxWidth: 320)
            .background(.regularMaterial)
            .presentationCompactAdaptation(.popover)
        }
    }
}
