import SwiftUI
import SwiftData
import BackgroundTasks

@main
struct ReaderApp: App {
    let container: ModelContainer
    @State private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let container = try! ModelContainer(for: SDLabel.self, SDItem.self, SDPendingAction.self)
        self.container = container
        _model = State(initialValue: AppModel(context: container.mainContext))
    }

    var body: some Scene {
        WindowGroup {
            ScreenshotHarness.rootView()
                .environment(model)
                .task { await model.refreshLabels() }
        }
        .modelContainer(container)
        .onChange(of: scenePhase) { _, phase in
            // Schedule the next best-effort refresh only once the scene (and thus
            // the .backgroundTask handler below) is registered — submitting before
            // registration throws.
            if phase == .background { BackgroundRefresh.schedule() }
        }
        .backgroundTask(.appRefresh(BackgroundRefresh.identifier)) {
            // Best-effort background pull (iOS 26 tightened cadence — server owns freshness).
            await model.refreshLabels()
            BackgroundRefresh.schedule()
        }
    }
}

// BGAppRefreshTask scheduling. Best-effort only; the handler is registered by the
// SwiftUI `.backgroundTask` modifier above.
enum BackgroundRefresh {
    static let identifier = "com.reader.personal.refresh"

    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}
