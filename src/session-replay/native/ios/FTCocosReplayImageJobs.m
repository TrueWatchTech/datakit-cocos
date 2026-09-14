#import "FTCocosReplayImageJobs.h"

@interface FTCocosReplayImageJob : NSObject
@property (nonatomic, copy) NSString *identifier;
@property (nonatomic, copy) NSString *response;
@end
@implementation FTCocosReplayImageJob
@end

static FTCocosReplayImageJob *currentJob;

@implementation FTCocosReplayImageJobs

+ (NSString *)beginWithWork:(NSString *(^)(void))work {
    FTCocosReplayImageJob *job = [FTCocosReplayImageJob new];
    job.identifier = NSUUID.UUID.UUIDString;
    @synchronized (self) {
        if (currentJob && !currentJob.response) {
            [NSException raise:NSInternalInconsistencyException format:@"Replay encoder is busy"];
        }
        currentJob = job;
    }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        @autoreleasepool {
            NSString *response;
            @try {
                response = work();
            } @catch (NSException *exception) {
                NSData *data = [NSJSONSerialization dataWithJSONObject:@{
                    @"ok": @NO, @"error": exception.reason ?: @"Replay encoding failed"
                } options:0 error:nil];
                response = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
            }
            @synchronized (self) {
                job.response = response ?: @"{\"ok\":false,\"error\":\"Empty Replay encoding result\"}";
            }
        }
    });
    return job.identifier;
}

+ (NSDictionary *)poll:(NSString *)identifier {
    @synchronized (self) {
        if (![currentJob.identifier isEqualToString:identifier]) {
            [NSException raise:NSInvalidArgumentException format:@"Replay encoding job is unavailable"];
        }
        if (!currentJob.response) return @{ @"pending": @YES };
        NSDictionary *result = @{ @"pending": @NO, @"response": currentJob.response };
        currentJob = nil;
        return result;
    }
}

@end
