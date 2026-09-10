#import "../../native/ios/FTCocosReplayImageJobs.h"
#include <assert.h>

static NSDictionary *waitForJob(NSString *identifier) {
    for (NSUInteger index = 0; index < 5000; index++) {
        NSDictionary *result = [FTCocosReplayImageJobs poll:identifier];
        if (![result[@"pending"] boolValue]) return result;
        [NSThread sleepForTimeInterval:0.001];
    }
    assert(NO && "encoding job timed out");
    return nil;
}

int main(void) {
    @autoreleasepool {
        dispatch_semaphore_t started = dispatch_semaphore_create(0);
        dispatch_semaphore_t finish = dispatch_semaphore_create(0);
        NSString *identifier = [FTCocosReplayImageJobs beginWithWork:^NSString *{
            assert(!NSThread.isMainThread);
            dispatch_semaphore_signal(started);
            dispatch_semaphore_wait(finish, DISPATCH_TIME_FOREVER);
            return @"{\"ok\":true,\"value\":\"image\"}";
        }];
        assert(dispatch_semaphore_wait(started, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);
        assert([[FTCocosReplayImageJobs poll:identifier][@"pending"] boolValue]);
        BOOL busyRejected = NO;
        @try { [FTCocosReplayImageJobs beginWithWork:^NSString *{ return @"unexpected"; }]; }
        @catch (NSException *exception) { busyRejected = [exception.reason containsString:@"busy"]; }
        assert(busyRejected);
        dispatch_semaphore_signal(finish);
        assert([waitForJob(identifier)[@"response"] containsString:@"image"]);
        NSString *failure = [FTCocosReplayImageJobs beginWithWork:^NSString *{
            [NSException raise:NSInternalInconsistencyException format:@"encode failed"];
            return nil;
        }];
        assert([waitForJob(failure)[@"response"] containsString:@"encode failed"]);
        NSString *next = [FTCocosReplayImageJobs beginWithWork:^NSString *{ return @"recovered"; }];
        assert([waitForJob(next)[@"response"] isEqualToString:@"recovered"]);
    }
    return 0;
}
