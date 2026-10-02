import XCTest

@MainActor
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
        app.buttons["Add task"].tap()
        let taskTitle = app.textFields["task-title"]
        XCTAssertTrue(taskTitle.waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.exists, "Opening the task editor should not open the keyboard.")
        let dueDateToggle = app.switches["task-has-due-date"]
        XCTAssertTrue(dueDateToggle.waitForExistence(timeout: 5))
        if (dueDateToggle.value as? String) != "1" {
            dueDateToggle.tap()
        }
        XCTAssertEqual(dueDateToggle.value as? String, "1", "Enabling a deadline should reveal its date control.")
        let dueDate = app.buttons["task-due-date"]
        if !dueDate.isHittable { app.swipeUp() }
        XCTAssertTrue(dueDate.waitForExistence(timeout: 5))
        let repeatSelector = app.buttons["selector-repeat"]
        XCTAssertTrue(repeatSelector.exists)
        XCTAssertLessThan(abs(dueDate.frame.width - repeatSelector.frame.width), 2,
            "Date and dropdown fields should share the same row width.")
        dueDate.tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5), "Date should open the app calendar, not an Apple DatePicker.")
        XCTAssertEqual(app.datePickers.count, 0)
        app.buttons["Done"].tap()
        app.switches["task-has-due-time"].tap()
        let dueTime = app.buttons["task-due-time"]
        XCTAssertTrue(dueTime.waitForExistence(timeout: 5))
        XCTAssertLessThan(abs(dueTime.frame.width - repeatSelector.frame.width), 2,
            "Time and dropdown fields should share the same row width.")
        dueTime.tap()
        XCTAssertTrue(app.staticTexts["Hour"].waitForExistence(timeout: 5), "Time should open the custom time selector.")
        XCTAssertEqual(app.datePickers.count, 0)
        app.buttons["Done"].tap()
        taskTitle.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()

        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))

        app.tabBars.buttons["Calendar"].tap()
        XCTAssertTrue(app.navigationBars["Calendar"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["TIMELINE"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["calendar-day-timeline"].exists)
        app.buttons["calendar-add-menu"].tap()
        XCTAssertTrue(app.buttons["Add task"].waitForExistence(timeout: 5))
    }
}
