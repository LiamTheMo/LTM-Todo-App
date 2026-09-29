import SwiftUI

@main
struct LTMTodoApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = TodoStore()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { store.refreshNotifications() }
                }
        }
    }
}
