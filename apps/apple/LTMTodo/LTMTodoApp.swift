import SwiftUI

@main
struct LTMTodoApp: App {
    @StateObject private var store = TodoStore()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store)
        }
    }
}
