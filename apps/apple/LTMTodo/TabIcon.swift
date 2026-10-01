import SwiftUI
import CoreGraphics

/// Original LTM Todo navigation artwork, drawn to stay crisp at tab-bar sizes.
struct TabIcon: View {
    let section: AppSection
    let isSelected: Bool

    private var ink: Color { isSelected ? LTMTheme.accent : Color.secondary }

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width, size.height) / 24
            let transform = CGAffineTransform(translationX: (size.width - 24 * scale) / 2,
                                              y: (size.height - 24 * scale) / 2)
                .scaledBy(x: scale, y: scale)
            let line = StrokeStyle(lineWidth: 1.65, lineCap: .round, lineJoin: .round)
            context.stroke(outline.applying(transform), with: .color(ink), style: line)
            context.fill(accent.applying(transform), with: .color(LTMTheme.accent))
        }
        .frame(width: 24, height: 24)
        .accessibilityHidden(true)
    }

    private var outline: Path {
        var path = Path()
        switch section {
        case .dashboard:
            path.addRoundedRect(in: CGRect(x: 3, y: 3.5, width: 18, height: 17), cornerSize: CGSize(width: 2.5, height: 2.5))
            path.move(to: CGPoint(x: 3, y: 9)); path.addLine(to: CGPoint(x: 21, y: 9))
            path.move(to: CGPoint(x: 11, y: 9)); path.addLine(to: CGPoint(x: 11, y: 20.5))
            path.move(to: CGPoint(x: 11, y: 14.5)); path.addLine(to: CGPoint(x: 21, y: 14.5))
            path.move(to: CGPoint(x: 6.6, y: 12.6)); path.addLine(to: CGPoint(x: 7.8, y: 13.8)); path.addLine(to: CGPoint(x: 9.8, y: 11.6))
        case .tasks:
            path.move(to: CGPoint(x: 8, y: 4.5)); path.addLine(to: CGPoint(x: 16, y: 4.5))
            path.addQuadCurve(to: CGPoint(x: 18, y: 6.5), control: CGPoint(x: 18, y: 4.5))
            path.addLine(to: CGPoint(x: 18, y: 20)); path.addLine(to: CGPoint(x: 6, y: 20)); path.addLine(to: CGPoint(x: 6, y: 6.5))
            path.addQuadCurve(to: CGPoint(x: 8, y: 4.5), control: CGPoint(x: 6, y: 4.5))
            path.addRoundedRect(in: CGRect(x: 9, y: 3, width: 6, height: 3), cornerSize: CGSize(width: 1, height: 1))
            path.move(to: CGPoint(x: 8.5, y: 10.2)); path.addLine(to: CGPoint(x: 9.9, y: 11.6)); path.addLine(to: CGPoint(x: 12.1, y: 9.2))
            path.move(to: CGPoint(x: 14.5, y: 10.8)); path.addLine(to: CGPoint(x: 16.5, y: 10.8))
            path.move(to: CGPoint(x: 8.5, y: 15.2)); path.addLine(to: CGPoint(x: 9.9, y: 16.6)); path.addLine(to: CGPoint(x: 12.1, y: 14.2))
            path.move(to: CGPoint(x: 14.5, y: 15.8)); path.addLine(to: CGPoint(x: 16.5, y: 15.8))
        case .projects:
            path.move(to: CGPoint(x: 4, y: 8.5)); path.addLine(to: CGPoint(x: 4, y: 6.8))
            path.addQuadCurve(to: CGPoint(x: 5.8, y: 5), control: CGPoint(x: 4, y: 5))
            path.addLine(to: CGPoint(x: 10.8, y: 5)); path.addLine(to: CGPoint(x: 12.8, y: 7)); path.addLine(to: CGPoint(x: 18.2, y: 7))
            path.addQuadCurve(to: CGPoint(x: 20, y: 8.8), control: CGPoint(x: 20, y: 7))
            path.addLine(to: CGPoint(x: 20, y: 9.5))
            path.move(to: CGPoint(x: 3.5, y: 10)); path.addLine(to: CGPoint(x: 20.5, y: 10)); path.addLine(to: CGPoint(x: 19.1, y: 18.2))
            path.addQuadCurve(to: CGPoint(x: 17.1, y: 19.9), control: CGPoint(x: 18.9, y: 19.9))
            path.addLine(to: CGPoint(x: 6.9, y: 19.9))
            path.addQuadCurve(to: CGPoint(x: 4.9, y: 18.2), control: CGPoint(x: 5.1, y: 19.9))
            path.closeSubpath()
            path.move(to: CGPoint(x: 8, y: 13.5)); path.addLine(to: CGPoint(x: 13.5, y: 13.5))
        case .calendar:
            path.addRoundedRect(in: CGRect(x: 3, y: 5, width: 18, height: 16), cornerSize: CGSize(width: 2.5, height: 2.5))
            path.move(to: CGPoint(x: 7.5, y: 3.5)); path.addLine(to: CGPoint(x: 7.5, y: 6.5))
            path.move(to: CGPoint(x: 16.5, y: 3.5)); path.addLine(to: CGPoint(x: 16.5, y: 6.5))
            path.move(to: CGPoint(x: 3, y: 9.5)); path.addLine(to: CGPoint(x: 21, y: 9.5))
            for (x, y, width) in [(CGFloat(7), CGFloat(13), CGFloat(2)), (CGFloat(12), CGFloat(13), CGFloat(2)),
                                  (CGFloat(7), CGFloat(17), CGFloat(2)), (CGFloat(12), CGFloat(17), CGFloat(2))] {
                path.move(to: CGPoint(x: x, y: y)); path.addLine(to: CGPoint(x: x + width, y: y))
            }
            path.move(to: CGPoint(x: 17, y: 13)); path.addLine(to: CGPoint(x: 17.1, y: 13))
        case .settings:
            let center = CGPoint(x: 12, y: 12.9)
            for index in 0..<32 {
                let angle = (Double(index) / 32 * 360 - 90) * .pi / 180
                let toothPosition = index % 4
                let radius: CGFloat = toothPosition == 1 || toothPosition == 2 ? 9.6 : 8.5
                let point = CGPoint(x: center.x + radius * CGFloat(cos(angle)), y: center.y + radius * CGFloat(sin(angle)))
                if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
            }
            path.closeSubpath()
            path.addEllipse(in: CGRect(x: 8.9, y: 9.8, width: 6.2, height: 6.2))
        }
        return path
    }

    private var accent: Path {
        switch section {
        case .dashboard: Path(ellipseIn: CGRect(x: 14.25, y: 15.75, width: 2.5, height: 2.5))
        case .tasks: Path(ellipseIn: CGRect(x: 16.45, y: 5.35, width: 2.3, height: 2.3))
        case .projects: Path(ellipseIn: CGRect(x: 15.55, y: 12.85, width: 2.3, height: 2.3))
        case .calendar: Path(ellipseIn: CGRect(x: 15.85, y: 15.85, width: 2.3, height: 2.3))
        case .settings: Path(ellipseIn: CGRect(x: 10.9, y: 11.8, width: 2.2, height: 2.2))
        }
    }
}
