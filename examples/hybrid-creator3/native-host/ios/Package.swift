// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "HybridSampleHost",
    platforms: [.iOS(.v12)],
    products: [.library(name: "HybridSampleHost", targets: ["HybridSampleHost"])],
    // This package is staged beside cocos-sdk-native by native:install.
    dependencies: [.package(name: "FTCocosBridge", path: "../../cocos-sdk-native/FTCocosBridge")],
    targets: [.target(
        name: "HybridSampleHost",
        dependencies: [.product(name: "FTCocosBridge", package: "FTCocosBridge")],
        path: ".",
        exclude: ["HybridSampleHost.podspec"],
        sources: ["HybridSampleSDK.m"],
        publicHeadersPath: "include",
        cSettings: [.headerSearchPath(".")]
    )]
)
