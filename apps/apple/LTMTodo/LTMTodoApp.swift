import SwiftUI

@main
struct LTMTodoApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = TodoStore()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        store.expireOldHistory()
                        store.refreshNotifications()
                    }
                }
                .task {
                    while !Task.isCancelled {
                        store.expireOldHistory()
                        try? await Task.sleep(nanoseconds: 60_000_000_000)
                    }
                }
        }
    }
}
