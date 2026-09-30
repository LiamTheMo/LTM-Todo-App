import SwiftUI

enum LTMTheme {
    static let accent = Color(red: 0.78, green: 0.42, blue: 0.14)
    static let overdue = Color(red: 0.72, green: 0.29, blue: 0.21)
    static let overdueSurface = Color(red: 1.0, green: 0.95, blue: 0.93)
    static let overdueBorder = Color(red: 0.90, green: 0.77, blue: 0.72)

    enum Space {
        static let small: CGFloat = 8
        static let medium: CGFloat = 16
        static let large: CGFloat = 24
    }

    enum Radius {
        static let card: CGFloat = 16
        static let control: CGFloat = 10
    }
}
