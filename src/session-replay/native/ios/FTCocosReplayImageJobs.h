#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/** One background image operation, with nonblocking result retrieval from JSB. */
@interface FTCocosReplayImageJobs : NSObject
+ (NSString *)beginWithWork:(NSString *(^)(void))work;
+ (NSDictionary *)poll:(NSString *)identifier;
@end

NS_ASSUME_NONNULL_END
