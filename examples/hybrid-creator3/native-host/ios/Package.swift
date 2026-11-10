// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "HybridSampleHost",
    platforms: [.iOS(.v15)],
    products: [.library(name: "HybridSampleHost", targets: ["HybridSampleHost"])],
    // This package is staged beside cocos-sdk-native by native:install.
    dependencies: [
        .package(name: "FTCocosBridge", path: "../../cocos-sdk-native/FTCocosBridge"),
        .package(url: "https://github.com/TrueWatchTech/datakit-ios.git", .exact("1.6.8")),
    ],
    targets: [.target(
        name: "HybridSampleHost",
        dependencies: [
            .product(name: "FTCocosBridge", package: "FTCocosBridge"),
            .product(name: "TrueWatchSDK", package: "datakit-ios"),
            .product(name: "TrueWatchSessionReplay", package: "datakit-ios"),
        ],
        path: ".",
        exclude: ["HybridSampleHost.podspec"],
        sources: ["HybridSampleSDK.m"],
        publicHeadersPath: "include",
        cSettings: [.headerSearchPath(".")]
    )]
)
