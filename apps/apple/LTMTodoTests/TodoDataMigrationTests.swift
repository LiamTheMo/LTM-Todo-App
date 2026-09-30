import XCTest
@testable import LTMTodo

final class TodoDataMigrationTests: XCTestCase {
    func testLegacyV1SnapshotFillsNewTaskFieldsAndKeepsIdentity() throws {
        let bundle = Bundle(for: Self.self)
        let fixtureURL = bundle.url(forResource: "legacy-v1", withExtension: "json")
            ?? bundle.url(forResource: "legacy-v1", withExtension: "json", subdirectory: "Fixtures")
        let fixture = try XCTUnwrap(fixtureURL)
        let migrated = try TodoDataFile.load(from: fixture)

        XCTAssertEqual(migrated.schemaVersion, 1)
        XCTAssertEqual(migrated.tasks.count, 1)
        XCTAssertEqual(migrated.tasks[0].id.uuidString, "8A00FEC0-E034-4D25-9B6C-ED24B9681724")
        XCTAssertEqual(migrated.tasks[0].title, "Legacy task")
        XCTAssertEqual(migrated.tasks[0].dueDay, "2026-09-29")
        XCTAssertEqual(migrated.tasks[0].notes, "")
        XCTAssertEqual(migrated.tasks[0].tagIDs, [])
        XCTAssertEqual(migrated.tasks[0].revision, 1)
        XCTAssertEqual(migrated.projects.first?.name, "Legacy project")
        XCTAssertEqual(migrated.projects.first?.revision, 1)
        XCTAssertEqual(migrated.tags.first?.name, "Legacy tag")
        XCTAssertEqual(migrated.sections.first?.name, "Legacy section")
        XCTAssertEqual(migrated.sections.first?.revision, 1)
        XCTAssertEqual(migrated.completions.first?.occurrenceDay, nil)
    }

    func testMissingCollectionsRemainBackwardCompatible() throws {
        let data = Data(#"{"schemaVersion":1}"#.utf8)
        let restored = try TodoDataFile.decode(data)

        XCTAssertTrue(restored.tasks.isEmpty)
        XCTAssertTrue(restored.projects.isEmpty)
        XCTAssertTrue(restored.tags.isEmpty)
        XCTAssertTrue(restored.sections.isEmpty)
        XCTAssertTrue(restored.completions.isEmpty)
    }

    func testUnsupportedVersionAndCorruptJSONFailClosed() {
        XCTAssertThrowsError(try TodoDataFile.decode(Data(#"{"schemaVersion":2}"#.utf8)))
        XCTAssertThrowsError(try TodoDataFile.decode(Data("not json".utf8)))
    }
}
