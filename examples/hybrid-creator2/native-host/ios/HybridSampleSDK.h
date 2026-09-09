#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/** Native SDK owner for the Cocos Hybrid sample. */
@interface HybridSampleSDK : NSObject

/** Call before Cocos starts JavaScript. */
+ (void)start;

/** Presents the native sample page over the Cocos view controller. */
+ (void)showNativePage;

/** Dismisses the native page so Cocos can claim RUM View and Replay ownership. */
+ (void)showCocosPage;

/** Read by Cocos before entering or re-entering its Hybrid lifecycle. */
+ (BOOL)isNativePageVisible;

@end

NS_ASSUME_NONNULL_END
