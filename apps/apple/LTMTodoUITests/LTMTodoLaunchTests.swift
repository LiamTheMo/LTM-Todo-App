import XCTest

final class LTMTodoLaunchTests: XCTestCase {
    func testDashboardLaunchAndPrimaryNavigation() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting"]
        app.launch()

        XCTAssertTrue(app.navigationBars["Dashboard"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["OVERDUE"].exists)
        XCTAssertTrue(app.staticTexts["Nothing overdue"].exists)
        XCTAssertTrue(app.buttons["Today"].exists)

        XCTAssertFalse(app.tabBars.buttons["Inbox"].exists)
        XCTAssertTrue(app.tabBars.buttons["Dashboard"].exists)
        XCTAssertTrue(app.tabBars.buttons["Calendar"].exists)
        XCTAssertTrue(app.tabBars.buttons["Projects"].exists)
        XCTAssertTrue(app.tabBars.buttons["Settings"].exists)
        app.tabBars.buttons["Projects"].tap()
        XCTAssertTrue(app.navigationBars["Projects"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Tasks"].tap()
        XCTAssertTrue(app.navigationBars["Tasks"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["Add a task…"].exists)

        app.tabBars.buttons["Calendar"].tap()
        XCTAssertTrue(app.navigationBars["Calendar"].waitForExistence(timeout: 5))
        app.buttons["Add"].tap()
        XCTAssertTrue(app.buttons["Add task"].waitForExistence(timeout: 5))
        app.buttons["Add task"].tap()
        XCTAssertTrue(app.navigationBars["Task"].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.tabBars.buttons["Settings"].exists)
        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
    }
}
