import Foundation

public struct TaskID: Hashable, Codable, Sendable {
    public let rawValue: UUID
    public init(rawValue: UUID = UUID()) { self.rawValue = rawValue }
}

public protocol TaskRepository: Sendable {
    // Phase 2 adds task persistence operations.
}
