// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LTMCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "LTMCore", targets: ["LTMCore"])],
    targets: [
        .target(name: "LTMCore"),
        .testTarget(name: "LTMCoreTests", dependencies: ["LTMCore"])
    ]
)
