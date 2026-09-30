import XCTest

final class LTMTodoLaunchTests: XCTestCase {
    func testDashboardLaunchAndPrimaryNavigation() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting"]
        app.launch()

        XCTAssertTrue(app.navigationBars["Dashboard"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["OVERDUE"].exists)
        XCTAssertTrue(app.staticTexts["Nothing overdue"].exists)
        XCTAssertTrue(app.buttons["Return to Today"].exists)

        app.tabBars.buttons["Tasks"].tap()
        XCTAssertTrue(app.navigationBars["Tasks"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["Add a task…"].exists)
    }
}
