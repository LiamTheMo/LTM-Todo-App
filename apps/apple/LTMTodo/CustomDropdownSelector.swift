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
        Button { isPresented = true } label: {
            HStack(spacing: 12) {
                Text(title).foregroundStyle(.primary)
                Spacer(minLength: 8)
                Text(selectedOption?.title ?? "Choose…")
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(LTMTheme.accent)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
