// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "FTCocosReplayBridge",
    platforms: [.iOS(.v12)],
    products: [.library(name: "FTCocosReplayBridge", targets: ["FTCocosReplayBridge"])],
    dependencies: [
        .package(url: "https://github.com/TrueWatchTech/datakit-ios.git", .exact("1.6.8-alpha.5")),
    ],
    targets: [
        .target(
            name: "FTCocosReplayBridge",
            dependencies: [
                .product(name: "TrueWatchSDK", package: "datakit-ios"),
                .product(name: "TrueWatchSessionReplay", package: "datakit-ios"),
            ],
            path: ".",
            exclude: ["FTCocosReplayBridge.podspec"],
            sources: ["FTCocosReplayBridge.m", "FTCocosReplayImageJobs.m"],
            publicHeadersPath: "include",
            cSettings: [.headerSearchPath(".")],
            linkerSettings: [.linkedFramework("UIKit")]
        ),
    ]
)
