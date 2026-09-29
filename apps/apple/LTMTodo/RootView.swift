import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard"
    case inbox = "Inbox"
    case tasks = "Tasks"
    case projects = "Projects"
    case settings = "Settings"

    var id: Self { self }

    var icon: String {
        switch self {
        case .dashboard: "rectangle.grid.1x2"
        case .inbox: "tray"
        case .tasks: "checkmark.circle"
        case .projects: "folder"
        case .settings: "gearshape"
        }
    }
}

struct RootView: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var selection: AppSection = .dashboard

    var body: some View {
        Group {
            if sizeClass == .regular {
                NavigationSplitView {
                    List(AppSection.allCases, selection: $selection) { section in
                        Label(section.rawValue, systemImage: section.icon)
                            .tag(section)
                    }
                    .navigationTitle("LTM Todo")
                } detail: {
                    destination(for: selection)
                }
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
    }

    @ViewBuilder
    private func destination(for section: AppSection) -> some View {
        switch section {
        case .dashboard: DashboardView()
        default: PlaceholderView(section: section)
        }
    }
}

private struct PlaceholderView: View {
    let section: AppSection

    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                "\(section.rawValue) foundation ready",
                systemImage: section.icon,
                description: Text("This surface is reserved for its implementation phase.")
            )
            .navigationTitle(section.rawValue)
        }
    }
}
