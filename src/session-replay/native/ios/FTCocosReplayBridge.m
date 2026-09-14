#import "FTCocosReplayBridge.h"
#import "FTCocosReplayImageJobs.h"
#import "FTMobileAgent.h"
#import "FTSessionReplay.h"
#import <UIKit/UIKit.h>
#import <objc/message.h>

@implementation FTCocosReplayBridge

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
    if ([method isEqualToString:@"replay.capabilities"]) {
        [self ensureExternalReplayAPIForConfig:[[FTSessionReplayConfig alloc] init]];
        if ([arguments[@"hybrid"] boolValue]) { [self ensureNativeHostInitialized]; [self ensureHybridRecorderSwitch]; }
        return @{ @"protocol": @1 };
    }
    if ([method isEqualToString:@"replay.beginSaveImage"]) return [self beginSaveImage:arguments];
    if ([method isEqualToString:@"replay.pollSaveImage"]) {
        return [FTCocosReplayImageJobs poll:[self requiredText:arguments key:@"job"]];
    }
    if ([method isEqualToString:@"hybrid.setExternalRecorderActive"]) {
        [self ensureNativeHostInitialized];
        [self setExternalRecorderActive:[arguments[@"active"] boolValue]];
        return nil;
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

+ (NSString *)beginSaveImage:(NSDictionary *)arguments {
    NSString *method = [self requiredText:arguments key:@"method"];
    if (![method isEqualToString:@"replay.saveImage"] && ![method isEqualToString:@"replay.saveImageV2"]) {
        [self fail:@"Unsupported asynchronous Replay method"];
    }
    NSDictionary *payload = [[self dictionary:arguments[@"arguments"]] copy];
    if (!payload) [self fail:@"Replay image arguments are required"];
    return [FTCocosReplayImageJobs beginWithWork:^NSString *{
        return [self responseWithValue:[self dispatch:method arguments:payload] error:nil];
    }];
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

+ (void)ensureNativeHostInitialized {
    @try {
        if (![FTMobileAgent sharedInstance]) {
            [self fail:@"The native host must initialize the native SDK before FTCocosSDK.attach()"];
        }
    } @catch (__unused NSException *exception) {
        [self fail:@"The native host must initialize the native SDK before FTCocosSDK.attach()"];
    }
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

+ (void)fail:(NSString *)message {
    @throw [NSException exceptionWithName:@"FTCocosBridgeError" reason:message userInfo:nil];
}

@end
