import Foundation

public protocol AppClock: Sendable {
    func now() -> Date
}

public struct SystemClock: AppClock {
    public init() {}
    public func now() -> Date { Date() }
}

public struct FixedClock: AppClock {
    private let value: Date
    public init(_ value: Date) { self.value = value }
    public func now() -> Date { value }
}
