#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/** Cocos JSB reflection entry point. */
@interface FTCocosBridge : NSObject
+ (NSString *)invoke:(NSString *)method payload:(NSString *)payload;
@end

NS_ASSUME_NONNULL_END
