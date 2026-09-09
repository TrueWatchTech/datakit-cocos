#import "HybridSampleSDK.h"
#import "HybridSampleEnvironment.generated.h"

#import <TrueWatchSDK/TrueWatchSDK.h>
#import <TrueWatchSDK/TrueWatchSessionReplay.h>

static BOOL FTHybridNativePageVisible = YES;
static __weak UIViewController *FTHybridNativePageController;

@interface FTHybridSampleNativeViewController : UIViewController
@property (nonatomic, strong) UILabel *statusLabel;
@end

@implementation FTHybridSampleNativeViewController

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor colorWithRed:12.0 / 255.0
                                                green:18.0 / 255.0
                                                 blue:34.0 / 255.0
                                                alpha:1];

    UILabel *title = [self label:@"Cocos Hybrid · Native iOS Page" size:30 color:UIColor.whiteColor];
    UILabel *subtitle = [self label:@"Native SDK owns initialization. Open Cocos to transfer RUM View and Replay ownership."
                                   size:17
                                  color:[UIColor colorWithRed:151.0 / 255.0 green:164.0 / 255.0 blue:190.0 / 255.0 alpha:1]];
    UIButton *request = [self button:@"Native Auto Network" action:@selector(sendNativeRequest)];
    UIButton *openCocos = [self button:@"Open Cocos Page" action:@selector(openCocos)];
    UIStackView *actions = [[UIStackView alloc] initWithArrangedSubviews:@[request, openCocos]];
    actions.axis = UILayoutConstraintAxisHorizontal;
    actions.spacing = 16;
    actions.distribution = UIStackViewDistributionFillEqually;

    self.statusLabel = [self label:@"Native page active · NSURLSession automatic telemetry enabled"
                                  size:17
                                 color:[UIColor colorWithRed:44.0 / 255.0 green:202.0 / 255.0 blue:178.0 / 255.0 alpha:1]];
    self.statusLabel.backgroundColor = [UIColor colorWithRed:27.0 / 255.0 green:39.0 / 255.0 blue:64.0 / 255.0 alpha:1];
    self.statusLabel.layer.cornerRadius = 12;
    self.statusLabel.layer.masksToBounds = YES;

    UIStackView *content = [[UIStackView alloc] initWithArrangedSubviews:@[title, subtitle, actions, self.statusLabel]];
    content.translatesAutoresizingMaskIntoConstraints = NO;
    content.axis = UILayoutConstraintAxisVertical;
    content.spacing = 24;
    [self.view addSubview:content];
    [NSLayoutConstraint activateConstraints:@[
        [content.leadingAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.leadingAnchor constant:48],
        [content.trailingAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.trailingAnchor constant:-48],
        [content.centerYAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.centerYAnchor],
        [actions.heightAnchor constraintEqualToConstant:58],
        [self.statusLabel.heightAnchor constraintEqualToConstant:68],
    ]];
}

- (UILabel *)label:(NSString *)text size:(CGFloat)size color:(UIColor *)color {
    UILabel *label = [[UILabel alloc] init];
    label.text = text;
    label.textColor = color;
    label.font = [UIFont systemFontOfSize:size weight:UIFontWeightMedium];
    label.textAlignment = NSTextAlignmentCenter;
    label.numberOfLines = 0;
    return label;
}

- (UIButton *)button:(NSString *)title action:(SEL)action {
    UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
    [button setTitle:title forState:UIControlStateNormal];
    button.titleLabel.font = [UIFont systemFontOfSize:17 weight:UIFontWeightSemibold];
    button.backgroundColor = [UIColor colorWithRed:73.0 / 255.0 green:142.0 / 255.0 blue:245.0 / 255.0 alpha:1];
    [button setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
    button.layer.cornerRadius = 12;
    [button addTarget:self action:action forControlEvents:UIControlEventTouchUpInside];
    return button;
}

- (void)openCocos {
    self.statusLabel.text = @"Opening Cocos page…";
    [HybridSampleSDK showCocosPage];
}

- (void)sendNativeRequest {
    self.statusLabel.text = @"Native NSURLSession request in progress…";
    NSString *url = [NSString stringWithFormat:
                     @"https://httpbin.org/get?sample=cocos-hybrid-creator3&layer=native-auto&request_id=%.0f",
                     NSDate.date.timeIntervalSince1970 * 1000];
    NSURLSessionDataTask *task = [NSURLSession.sharedSession
        dataTaskWithURL:[NSURL URLWithString:url]
      completionHandler:^(__unused NSData *data, NSURLResponse *response, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (error) {
                self.statusLabel.text = [NSString stringWithFormat:@"Native auto request failed: %@", error.localizedDescription];
                return;
            }
            NSInteger statusCode = [(NSHTTPURLResponse *)response statusCode];
            self.statusLabel.text = [NSString stringWithFormat:@"Native auto Resource + Trace completed (%ld)", (long)statusCode];
        });
    }];
    [task resume];
}

@end

@implementation HybridSampleSDK

+ (void)start {
    NSCAssert(FTHybridSampleIOSRumAppID.length > 0,
              @"Set SAMPLE_IOS_APP_ID before building the iOS sample");

    FTSDKConfig *sdkConfig;
    if (FTHybridSampleDatakitURL.length > 0) {
        sdkConfig = [[FTSDKConfig alloc] initWithDatakitUrl:FTHybridSampleDatakitURL];
    } else {
        sdkConfig = [[FTSDKConfig alloc] initWithDatawayUrl:FTHybridSampleDatawayURL
                                               clientToken:FTHybridSampleClientToken];
    }
    sdkConfig.enableSDKDebugLog = FTHybridSampleDebug;
    sdkConfig.service = FTHybridSampleServiceName;
    sdkConfig.env = FTHybridSampleEnv;
    sdkConfig.globalContext = @{ @"sample_name": @"cocos-hybrid-creator3" };
    [FTMobileAgent startWithConfigOptions:sdkConfig];

    FTRumConfig *rumConfig = [[FTRumConfig alloc] initWithAppid:FTHybridSampleIOSRumAppID];
    rumConfig.sampleRate = 100;
    rumConfig.sessionOnErrorSampleRate = 100;
    rumConfig.enableTraceUserAction = YES;
    rumConfig.enableTraceUserView = YES;
    rumConfig.enableTraceUserResource = YES;
    rumConfig.enableTrackAppCrash = YES;
    [rumConfig setEnableTrackAppFreeze:YES freezeDurationMs:100];
    [[FTMobileAgent sharedInstance] startRumWithConfigOptions:rumConfig];

    FTLoggerConfig *loggerConfig = [[FTLoggerConfig alloc] init];
    loggerConfig.sampleRate = 100;
    loggerConfig.enableCustomLog = YES;
    loggerConfig.enableLinkRumData = YES;
    loggerConfig.printCustomLogToConsole = YES;
    [[FTMobileAgent sharedInstance] startLoggerWithConfigOptions:loggerConfig];

    FTTraceConfig *traceConfig = [[FTTraceConfig alloc] init];
    traceConfig.sampleRate = 100;
    traceConfig.networkTraceType = FTNetworkTraceTypeDDtrace;
    traceConfig.enableLinkRumData = YES;
    [[FTMobileAgent sharedInstance] startTraceWithConfigOptions:traceConfig];

    // Keep native recording enabled by default. enterCocos()/leaveCocos() switch
    // recorder ownership between native UI and the Cocos canvas at runtime.
    FTSessionReplayConfig *replayConfig = [[FTSessionReplayConfig alloc] init];
    replayConfig.sampleRate = 100;
    replayConfig.sessionReplayOnErrorSampleRate = 100;
    replayConfig.touchPrivacy = FTTouchPrivacyLevelShow;
    replayConfig.textAndInputPrivacy = FTTextAndInputPrivacyLevelMaskSensitiveInputs;
    replayConfig.imagePrivacy = FTImagePrivacyLevelMaskNone;
    [[FTRumSessionReplay sharedInstance] startWithSessionReplayConfig:replayConfig];

    // Keep Cocos attached but not entered until the initial native page is dismissed.
    FTHybridNativePageVisible = YES;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.1 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        [self showNativePage];
    });
}

+ (void)showNativePage {
    FTHybridNativePageVisible = YES;
    dispatch_async(dispatch_get_main_queue(), ^{
        UIViewController *presented = FTHybridNativePageController;
        if (presented.presentingViewController) return;

        UIWindow *window = UIApplication.sharedApplication.delegate.window;
        UIViewController *root = window.rootViewController;
        while (root.presentedViewController) root = root.presentedViewController;
        if (!root) return;

        FTHybridSampleNativeViewController *controller = [[FTHybridSampleNativeViewController alloc] init];
        controller.modalPresentationStyle = UIModalPresentationFullScreen;
        FTHybridNativePageController = controller;
        [root presentViewController:controller animated:YES completion:nil];
    });
}

+ (void)showCocosPage {
    dispatch_async(dispatch_get_main_queue(), ^{
        UIViewController *controller = FTHybridNativePageController;
        if (!controller) {
            FTHybridNativePageVisible = NO;
            return;
        }
        [controller dismissViewControllerAnimated:YES completion:^{
            FTHybridNativePageVisible = NO;
            FTHybridNativePageController = nil;
        }];
    });
}

+ (BOOL)isNativePageVisible {
    return FTHybridNativePageVisible;
}

@end
