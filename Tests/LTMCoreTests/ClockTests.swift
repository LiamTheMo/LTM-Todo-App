import Foundation
import Testing
@testable import LTMCore

@Test func fixedClockIsDeterministic() {
    let date = Date(timeIntervalSince1970: 1_800_000_000)
    #expect(FixedClock(date).now() == date)
}

@Test func taskIDsPreserveIdentity() {
    let uuid = UUID()
    #expect(TaskID(rawValue: uuid).rawValue == uuid)
}
