#import "FTCocosBridge.h"

#import "FTMobileSDK.h"
#import "FTSessionReplay.h"
#import <UIKit/UIKit.h>
#import <objc/message.h>

@implementation FTCocosBridge

+ (NSString *)invoke:(NSString *)method payload:(NSString *)payload {
    @try {
        NSData *data = [payload dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *arguments = data.length > 0
            ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
            : @{};
        if (![arguments isKindOfClass:NSDictionary.class]) {
            return [self responseWithValue:nil error:@"Payload must be a JSON object"];
        }
        id value = [self dispatch:method arguments:arguments];
        return [self responseWithValue:value error:nil];
    } @catch (NSException *exception) {
        return [self responseWithValue:nil error:[NSString stringWithFormat:@"%@: %@", exception.name, exception.reason ?: @"unknown error"]];
    }
}

+ (id)dispatch:(NSString *)method arguments:(NSDictionary *)arguments {
    FTExternalDataManager *rum = [FTExternalDataManager sharedManager];
    if ([method isEqualToString:@"hybrid.attach"]) {
        [self ensureNativeHostInitialized];
        NSString *sdkVersion = [self text:arguments[@"sdkVersion"]];
        if (sdkVersion.length > 0) {
            [FTMobileAgent appendGlobalContext:@{ @"sdk_package_cocos": sdkVersion }];
        }
        if ([arguments[@"requiresReplay"] boolValue]) [self ensureHybridRecorderSwitch];
        return nil;
    }
    if ([method isEqualToString:@"hybrid.setExternalRecorderActive"]) {
        [self ensureNativeHostInitialized];
        [self setExternalRecorderActive:[arguments[@"active"] boolValue]];
        return nil;
    }
    if ([method isEqualToString:@"sdk.configure"]) {
        NSString *datakit = [self text:arguments[@"datakitUrl"]];
        NSString *dataway = [self text:arguments[@"datawayUrl"]];
        NSString *token = [self text:arguments[@"clientToken"]];
        FTSDKConfig *config;
        if (datakit.length > 0) {
            config = [[FTSDKConfig alloc] initWithDatakitUrl:datakit];
        } else if (dataway.length > 0 && token.length > 0) {
            config = [[FTSDKConfig alloc] initWithDatawayUrl:dataway clientToken:token];
        } else {
            [self fail:@"datakitUrl or datawayUrl/clientToken is required"];
        }
        if (arguments[@"debug"]) config.enableSDKDebugLog = [arguments[@"debug"] boolValue];
        if ([self text:arguments[@"env"]].length > 0) config.env = arguments[@"env"];
        if ([self text:arguments[@"serviceName"]].length > 0) config.service = arguments[@"serviceName"];
        if ([arguments[@"globalContext"] isKindOfClass:NSDictionary.class]) config.globalContext = arguments[@"globalContext"];
        [FTMobileAgent startWithConfigOptions:config];
        return nil;
    }
    if ([method isEqualToString:@"sdk.bindUser"]) {
        [[FTMobileAgent sharedInstance]
            bindUserWithUserID:[self requiredText:arguments key:@"userId"]
            userName:[self text:arguments[@"userName"]]
            userEmail:[self text:arguments[@"userEmail"]]
            extra:[self dictionary:arguments[@"extra"]]];
        return nil;
    }
    if ([method isEqualToString:@"sdk.unbindUser"]) {
        [[FTMobileAgent sharedInstance] unbindUser];
        return nil;
    }
    if ([method isEqualToString:@"sdk.shutdown"]) {
        [FTMobileAgent shutDown];
        return nil;
    }
    if ([method isEqualToString:@"rum.configure"]) {
        NSString *appID = [self text:arguments[@"iosAppId"]];
        if (appID.length == 0) [self fail:@"rum.iosAppId is required on iOS"];
        FTRumConfig *config = [[FTRumConfig alloc] initWithAppid:appID];
        if (arguments[@"sampleRate"]) config.sampleRate = [self percent:arguments[@"sampleRate"]];
        if (arguments[@"sessionOnErrorSampleRate"]) config.sessionOnErrorSampleRate = [self percent:arguments[@"sessionOnErrorSampleRate"]];
        if (arguments[@"enableNativeUserAction"]) config.enableTraceUserAction = [arguments[@"enableNativeUserAction"] boolValue];
        if (arguments[@"enableNativeUserView"]) config.enableTraceUserView = [arguments[@"enableNativeUserView"] boolValue];
        if (arguments[@"enableNativeUserResource"]) config.enableTraceUserResource = [arguments[@"enableNativeUserResource"] boolValue];
        if (arguments[@"enableNativeCrash"]) config.enableTrackAppCrash = [arguments[@"enableNativeCrash"] boolValue];
        if (arguments[@"enableNativeAnr"]) config.enableTrackAppANR = [arguments[@"enableNativeAnr"] boolValue];
        if (arguments[@"enableNativeUiBlock"]) {
            [config setEnableTrackAppFreeze:[arguments[@"enableNativeUiBlock"] boolValue]
                          freezeDurationMs:[arguments[@"nativeUiBlockDurationMs"] longValue] ?: 250];
        }
        if (arguments[@"errorMonitorType"]) config.errorMonitorType = [arguments[@"errorMonitorType"] unsignedIntegerValue];
        if (arguments[@"deviceMetricsMonitorType"]) config.deviceMetricsMonitorType = [arguments[@"deviceMetricsMonitorType"] unsignedIntegerValue];
        config.monitorFrequency = [self monitorFrequency:[self text:arguments[@"detectFrequency"]]];
        if ([arguments[@"globalContext"] isKindOfClass:NSDictionary.class]) config.globalContext = arguments[@"globalContext"];
        [[FTMobileAgent sharedInstance] startRumWithConfigOptions:config];
        return nil;
    }
    if ([method isEqualToString:@"rum.startView"]) {
        [rum startViewWithName:[self requiredText:arguments key:@"name"] property:[self dictionary:arguments[@"attributes"]]];
        return nil;
    }
    if ([method isEqualToString:@"rum.stopView"]) {
        [rum stopViewWithProperty:[self dictionary:arguments[@"attributes"]]];
        return nil;
    }
    if ([method isEqualToString:@"rum.addAction"]) {
        [rum addAction:[self requiredText:arguments key:@"name"]
            actionType:[self text:arguments[@"type"]] ?: @"click"
              property:[self dictionary:arguments[@"attributes"]]];
        return nil;
    }
    if ([method isEqualToString:@"rum.startAction"]) {
        [rum startAction:[self requiredText:arguments key:@"name"]
              actionType:[self text:arguments[@"type"]] ?: @"click"
                property:[self dictionary:arguments[@"attributes"]]];
        return nil;
    }
    if ([method isEqualToString:@"rum.addError"]) {
        [rum addErrorWithType:[self text:arguments[@"type"]] ?: @"cocos_error"
                     message:[self text:arguments[@"message"]] ?: @""
                       stack:[self text:arguments[@"stack"]] ?: @""
                    property:[self dictionary:arguments[@"attributes"]]];
        return nil;
    }
    if ([method isEqualToString:@"rum.addLongTask"]) {
        [rum addLongTaskWithStack:[self text:arguments[@"stack"]] ?: @""
                         duration:arguments[@"durationNs"] ?: @0
                         property:[self dictionary:arguments[@"attributes"]]];
        return nil;
    }
    if ([method isEqualToString:@"rum.startResource"]) {
        [rum startResourceWithKey:[self requiredText:arguments key:@"key"] property:[self dictionary:arguments[@"attributes"]]];
        return nil;
    }
    if ([method isEqualToString:@"rum.stopResource"]) {
        [rum stopResourceWithKey:[self requiredText:arguments key:@"key"] property:[self dictionary:arguments[@"attributes"]]];
        return nil;
    }
    if ([method isEqualToString:@"rum.addResource"]) {
        [self addResource:arguments manager:rum];
        return nil;
    }
    if ([method isEqualToString:@"logger.configure"]) {
        FTLoggerConfig *config = [[FTLoggerConfig alloc] init];
        if (arguments[@"sampleRate"]) config.sampleRate = [self percent:arguments[@"sampleRate"]];
        if (arguments[@"enableLinkRumData"]) config.enableLinkRumData = [arguments[@"enableLinkRumData"] boolValue];
        if (arguments[@"enableCustomLog"]) config.enableCustomLog = [arguments[@"enableCustomLog"] boolValue];
        if (arguments[@"printCustomLogToConsole"]) config.printCustomLogToConsole = [arguments[@"printCustomLogToConsole"] boolValue];
        if (arguments[@"logCacheLimitCount"]) config.logCacheLimitCount = [arguments[@"logCacheLimitCount"] intValue];
        config.discardType = [[self text:arguments[@"discardStrategy"]] isEqualToString:@"discardOldest"] ? FTDiscardOldest : FTDiscard;
        if ([arguments[@"logLevelFilters"] isKindOfClass:NSArray.class]) config.logLevelFilter = [self logLevelFilters:arguments[@"logLevelFilters"]];
        if ([arguments[@"globalContext"] isKindOfClass:NSDictionary.class]) config.globalContext = arguments[@"globalContext"];
        [[FTMobileAgent sharedInstance] startLoggerWithConfigOptions:config];
        return nil;
    }
    if ([method isEqualToString:@"logger.log"]) {
        [[FTMobileAgent sharedInstance] logging:[self text:arguments[@"content"]] ?: @""
                                         status:[self logStatus:[self text:arguments[@"level"]]]
                                       property:[self dictionary:arguments[@"attributes"]]];
        return nil;
    }
    if ([method isEqualToString:@"trace.configure"]) {
        FTTraceConfig *config = [[FTTraceConfig alloc] init];
        if (arguments[@"sampleRate"]) config.sampleRate = [self percent:arguments[@"sampleRate"]];
        if (arguments[@"enableLinkRumData"]) config.enableLinkRumData = [arguments[@"enableLinkRumData"] boolValue];
        if (arguments[@"enableNativeAutoTrace"]) config.enableAutoTrace = [arguments[@"enableNativeAutoTrace"] boolValue];
        config.networkTraceType = [self traceType:[self text:arguments[@"traceType"]]];
        [[FTMobileAgent sharedInstance] startTraceWithConfigOptions:config];
        return nil;
    }
    if ([method isEqualToString:@"trace.getHeaders"]) {
        NSURL *url = [NSURL URLWithString:[self requiredText:arguments key:@"url"]];
        if (!url) [self fail:@"Invalid trace URL"];
        NSString *key = [self text:arguments[@"resourceKey"]];
        return key.length > 0 ? [rum getTraceHeaderWithKey:key url:url] : [rum getTraceHeaderWithUrl:url];
    }
    if ([method isEqualToString:@"replay.configure"]) {
        FTSessionReplayConfig *config = [[FTSessionReplayConfig alloc] init];
        [self ensureExternalReplayAPIForConfig:config];
        if (arguments[@"sampleRate"]) config.sampleRate = [self percent:arguments[@"sampleRate"]];
        if (arguments[@"sessionOnErrorSampleRate"]) config.sessionReplayOnErrorSampleRate = [self percent:arguments[@"sessionOnErrorSampleRate"]];
        if ([[self text:arguments[@"touchPrivacy"]] isEqualToString:@"show"]) config.touchPrivacy = FTTouchPrivacyLevelShow;
        SEL externalMode = NSSelectorFromString(@"setExternalRecorderMode:");
        ((void (*)(id, SEL, BOOL))objc_msgSend)(config, externalMode, YES);
        [[FTRumSessionReplay sharedInstance] startWithSessionReplayConfig:config];
        return nil;
    }
    if ([method isEqualToString:@"replay.getContext"]) {
        return [self invokeReplayObjectSelector:NSSelectorFromString(@"currentExternalRUMContext")];
    }
    if ([method isEqualToString:@"replay.saveImage"]) {
        NSData *rgba = [NSData dataWithContentsOfFile:[self requiredText:arguments key:@"path"]];
        if (!rgba) [self fail:@"Unable to read replay RGBA file"];
        NSData *png = [self pngDataFromRGBA:rgba
                                      width:[arguments[@"width"] unsignedIntegerValue]
                                     height:[arguments[@"height"] unsignedIntegerValue]];
        if (!png) [self fail:@"Unable to encode replay image"];
        return [self invokeReplayObjectSelector:NSSelectorFromString(@"saveExternalImageResourceData:mimeType:")
                                           first:png
                                          second:@"image/png"];
    }
    if ([method isEqualToString:@"replay.saveImageV2"]) {
        NSUInteger width = [arguments[@"width"] unsignedIntegerValue];
        NSUInteger height = [arguments[@"height"] unsignedIntegerValue];
        NSData *rgba = [NSData dataWithContentsOfFile:[self requiredText:arguments key:@"path"]];
        if (!rgba) [self fail:@"Unable to read replay RGBA file"];
        UIImage *image = [self imageFromRGBA:rgba width:width height:height];
        if (!image) [self fail:@"Unable to decode replay RGBA image"];

        CGFloat quality = MIN(1.0, MAX(0.1, [arguments[@"quality"] doubleValue] ?: 0.45));
        NSUInteger maxFrameBytes = [arguments[@"maxFrameBytes"] unsignedIntegerValue] ?: 40 * 1024;
        UIImage *encodedImage = [self opaqueImageFromImage:image size:CGSizeMake(width, height)];
        NSData *jpeg = UIImageJPEGRepresentation(encodedImage, quality);
        if (jpeg.length > maxFrameBytes) {
            quality = MAX(0.2, quality * 0.7);
            jpeg = UIImageJPEGRepresentation(encodedImage, quality);
        }
        if (jpeg.length > maxFrameBytes && width > 1 && height > 1) {
            width = MAX(1, (NSUInteger)floor(width * 0.75));
            height = MAX(1, (NSUInteger)floor(height * 0.75));
            encodedImage = [self opaqueImageFromImage:image size:CGSizeMake(width, height)];
            jpeg = UIImageJPEGRepresentation(encodedImage, quality);
        }
        if (!jpeg || jpeg.length > maxFrameBytes) return @{ @"accepted": @NO };

        NSString *resourceID = [self invokeReplayObjectSelector:NSSelectorFromString(@"saveExternalImageResourceData:mimeType:")
                                                          first:jpeg
                                                         second:@"image/jpeg"];
        if (resourceID.length == 0) [self fail:@"Unable to save replay image resource"];
        return @{
            @"accepted": @YES,
            @"resourceId": resourceID,
            @"byteSize": @(jpeg.length),
            @"width": @(width),
            @"height": @(height),
            @"mimeType": @"image/jpeg",
        };
    }
    if ([method isEqualToString:@"replay.writeSegment"]) {
        [self invokeReplayVoidSelector:NSSelectorFromString(@"writeExternalSegment:viewID:")
                                first:[self requiredText:arguments key:@"segment"]
                               second:[self requiredText:arguments key:@"viewId"]];
        return nil;
    }
    if ([method isEqualToString:@"replay.setRecordCount"]) {
        [self invokeReplayCountSelector:NSSelectorFromString(@"setExternalRecordCountForViewID:count:")
                                 viewID:[self requiredText:arguments key:@"viewId"]
                                  count:[arguments[@"count"] unsignedIntegerValue]];
        return nil;
    }
    if ([method isEqualToString:@"replay.stop"]) return nil;
    [self fail:[NSString stringWithFormat:@"Unknown bridge method: %@", method]];
    return nil;
}

+ (void)ensureNativeHostInitialized {
    @try {
        if (![FTMobileAgent sharedInstance]) {
            [self fail:@"The native host must initialize the native SDK before FTCocosSDK.attach()"];
        }
    } @catch (__unused NSException *exception) {
        [self fail:@"The native host must initialize the native SDK before FTCocosSDK.attach()"];
    }
}

+ (void)ensureHybridRecorderSwitch {
    SEL selector = NSSelectorFromString(@"setExternalRecorderActive:");
    if (![[FTRumSessionReplay sharedInstance] respondsToSelector:selector]) {
        [self fail:@"iOS Session Replay does not support Hybrid recorder switching; upgrade the Native SDK"];
    }
}

+ (void)setExternalRecorderActive:(BOOL)active {
    [self ensureHybridRecorderSwitch];
    SEL selector = NSSelectorFromString(@"setExternalRecorderActive:");
    ((void (*)(id, SEL, BOOL))objc_msgSend)([FTRumSessionReplay sharedInstance], selector, active);
}

+ (void)addResource:(NSDictionary *)arguments manager:(FTExternalDataManager *)manager {
    NSDictionary *input = [self dictionary:arguments[@"content"]] ?: @{};
    NSURL *url = [NSURL URLWithString:[self text:input[@"url"]] ?: @""];
    if (!url) [self fail:@"Invalid resource URL"];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = [self text:input[@"httpMethod"]] ?: @"GET";
    [request setAllHTTPHeaderFields:[self dictionary:input[@"requestHeaders"]]];
    NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc]
        initWithURL:url
        statusCode:[input[@"statusCode"] integerValue]
        HTTPVersion:@"HTTP/1.1"
        headerFields:[self dictionary:input[@"responseHeaders"]]];
    NSData *body = [[self text:input[@"responseBody"]] dataUsingEncoding:NSUTF8StringEncoding];
    FTResourceContentModel *content = [[FTResourceContentModel alloc] initWithRequest:request response:response data:body error:nil];

    NSDictionary *timings = [self dictionary:arguments[@"metrics"]];
    FTResourceMetricsModel *metrics = [[FTResourceMetricsModel alloc] init];
    metrics.fetchStartNsTimeInterval = [timings[@"fetchStartTime"] longLongValue];
    metrics.connectStartNsTimeInterval = [timings[@"tcpStartTime"] longLongValue];
    metrics.connectEndNsTimeInterval = [timings[@"tcpEndTime"] longLongValue];
    metrics.dnsStartNsTimeInterval = [timings[@"dnsStartTime"] longLongValue];
    metrics.dnsEndNsTimeInterval = [timings[@"dnsEndTime"] longLongValue];
    metrics.responseStartNsTimeInterval = [timings[@"responseStartTime"] longLongValue];
    metrics.responseEndNsTimeInterval = [timings[@"responseEndTime"] longLongValue];
    metrics.sslStartNsTimeInterval = [timings[@"sslStartTime"] longLongValue];
    metrics.sslEndNsTimeInterval = [timings[@"sslEndTime"] longLongValue];
    [manager addResourceWithKey:[self requiredText:arguments key:@"key"] metrics:metrics content:content];
}

+ (id)invokeReplayObjectSelector:(SEL)selector {
    id target = [FTRumSessionReplay sharedInstance];
    if (![target respondsToSelector:selector]) [self missingReplayAPI:selector];
    return ((id (*)(id, SEL))objc_msgSend)(target, selector);
}

+ (id)invokeReplayObjectSelector:(SEL)selector object:(id)object {
    id target = [FTRumSessionReplay sharedInstance];
    if (![target respondsToSelector:selector]) [self missingReplayAPI:selector];
    return ((id (*)(id, SEL, id))objc_msgSend)(target, selector, object);
}

+ (id)invokeReplayObjectSelector:(SEL)selector first:(id)first second:(id)second {
    id target = [FTRumSessionReplay sharedInstance];
    if (![target respondsToSelector:selector]) [self missingReplayAPI:selector];
    return ((id (*)(id, SEL, id, id))objc_msgSend)(target, selector, first, second);
}

+ (void)invokeReplayVoidSelector:(SEL)selector first:(id)first second:(id)second {
    id target = [FTRumSessionReplay sharedInstance];
    if (![target respondsToSelector:selector]) [self missingReplayAPI:selector];
    ((void (*)(id, SEL, id, id))objc_msgSend)(target, selector, first, second);
}

+ (void)invokeReplayCountSelector:(SEL)selector viewID:(NSString *)viewID count:(NSUInteger)count {
    id target = [FTRumSessionReplay sharedInstance];
    if (![target respondsToSelector:selector]) [self missingReplayAPI:selector];
    ((void (*)(id, SEL, id, NSUInteger))objc_msgSend)(target, selector, viewID, count);
}

+ (void)missingReplayAPI:(SEL)selector {
    [self fail:[NSString stringWithFormat:@"FTMobileSDK lacks external Session Replay API %@; use the Cocos-compatible iOS SDK release", NSStringFromSelector(selector)]];
}

+ (void)ensureExternalReplayAPIForConfig:(FTSessionReplayConfig *)config {
    SEL externalMode = NSSelectorFromString(@"setExternalRecorderMode:");
    if (![config respondsToSelector:externalMode]) [self missingReplayAPI:externalMode];

    id target = [FTRumSessionReplay sharedInstance];
    NSArray<NSString *> *selectorNames = @[
        @"currentExternalRUMContext",
        @"saveExternalImageResourceData:mimeType:",
        @"writeExternalSegment:viewID:",
        @"setExternalRecordCountForViewID:count:",
    ];
    for (NSString *name in selectorNames) {
        SEL selector = NSSelectorFromString(name);
        if (![target respondsToSelector:selector]) [self missingReplayAPI:selector];
    }
}

+ (NSData *)pngDataFromRGBA:(NSData *)rgba width:(NSUInteger)width height:(NSUInteger)height {
    UIImage *image = [self imageFromRGBA:rgba width:width height:height];
    return image ? UIImagePNGRepresentation(image) : nil;
}

+ (UIImage *)imageFromRGBA:(NSData *)rgba width:(NSUInteger)width height:(NSUInteger)height {
    if (width == 0 || height == 0 || width > NSUIntegerMax / height / 4 || rgba.length < width * height * 4) {
        return nil;
    }
    NSMutableData *pixels = [rgba mutableCopy];
    CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(pixels.mutableBytes,
                                                 width,
                                                 height,
                                                 8,
                                                 width * 4,
                                                 colorSpace,
                                                 (CGBitmapInfo)kCGBitmapByteOrderDefault |
                                                     (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
    CGColorSpaceRelease(colorSpace);
    if (!context) return nil;
    CGImageRef imageRef = CGBitmapContextCreateImage(context);
    CGContextRelease(context);
    if (!imageRef) return nil;
    UIImage *image = [UIImage imageWithCGImage:imageRef];
    CGImageRelease(imageRef);
    return image;
}

+ (UIImage *)opaqueImageFromImage:(UIImage *)image size:(CGSize)size {
    UIGraphicsBeginImageContextWithOptions(size, YES, 1.0);
    [[UIColor whiteColor] setFill];
    UIRectFill(CGRectMake(0, 0, size.width, size.height));
    [image drawInRect:CGRectMake(0, 0, size.width, size.height)];
    UIImage *opaque = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();
    return opaque;
}

+ (NSString *)responseWithValue:(id)value error:(NSString *)error {
    NSMutableDictionary *response = [@{ @"ok": @(error == nil) } mutableCopy];
    if (value) response[@"value"] = value;
    if (error) response[@"error"] = error;
    NSData *data = [NSJSONSerialization dataWithJSONObject:response options:0 error:nil];
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"{\"ok\":false}";
}

+ (NSDictionary *)dictionary:(id)value {
    return [value isKindOfClass:NSDictionary.class] ? value : nil;
}

+ (NSString *)text:(id)value {
    return [value isKindOfClass:NSString.class] && [value length] > 0 ? value : nil;
}

+ (NSString *)requiredText:(NSDictionary *)arguments key:(NSString *)key {
    NSString *value = [self text:arguments[key]];
    if (value.length == 0) [self fail:[NSString stringWithFormat:@"%@ is required", key]];
    return value;
}

+ (int)percent:(NSNumber *)number {
    return (int)lround(MIN(1.0, MAX(0.0, number.doubleValue)) * 100.0);
}

+ (FTLogStatus)logStatus:(NSString *)value {
    if ([value isEqualToString:@"warning"]) return FTStatusWarning;
    if ([value isEqualToString:@"error"]) return FTStatusError;
    if ([value isEqualToString:@"critical"]) return FTStatusCritical;
    if ([value isEqualToString:@"ok"]) return FTStatusOk;
    return FTStatusInfo;
}

+ (NSArray *)logLevelFilters:(NSArray *)values {
    NSMutableArray *result = [NSMutableArray arrayWithCapacity:values.count];
    for (id value in values) {
        if (![value isKindOfClass:NSString.class]) continue;
        NSString *level = value;
        if ([level isEqualToString:@"info"] ||
            [level isEqualToString:@"warning"] ||
            [level isEqualToString:@"error"] ||
            [level isEqualToString:@"critical"] ||
            [level isEqualToString:@"ok"]) {
            [result addObject:@([self logStatus:level])];
        } else {
            [result addObject:level];
        }
    }
    return result;
}

+ (FTNetworkTraceType)traceType:(NSString *)value {
    if ([value isEqualToString:@"zipkinMultiHeader"]) return FTNetworkTraceTypeZipkinMultiHeader;
    if ([value isEqualToString:@"zipkinSingleHeader"]) return FTNetworkTraceTypeZipkinSingleHeader;
    if ([value isEqualToString:@"traceparent"]) return FTNetworkTraceTypeTraceparent;
    if ([value isEqualToString:@"skywalking"]) return FTNetworkTraceTypeSkywalking;
    if ([value isEqualToString:@"jaeger"]) return FTNetworkTraceTypeJaeger;
    return FTNetworkTraceTypeDDtrace;
}

+ (FTMonitorFrequency)monitorFrequency:(NSString *)value {
    if ([value isEqualToString:@"frequent"]) return FTMonitorFrequencyFrequent;
    if ([value isEqualToString:@"rare"]) return FTMonitorFrequencyRare;
    return FTMonitorFrequencyDefault;
}

+ (void)fail:(NSString *)message {
    @throw [NSException exceptionWithName:@"FTCocosBridgeError" reason:message userInfo:nil];
}

@end
