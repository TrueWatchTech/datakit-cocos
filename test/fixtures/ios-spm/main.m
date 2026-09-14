#import <UIKit/UIKit.h>
#import <objc/message.h>

// Resolve exactly as Cocos does: no direct reference may keep the bridge linked.
int main(int argc, char *argv[]) {
    @autoreleasepool {
        Class bridge = NSClassFromString(@"FTCocosBridge");
        if (!bridge) { NSLog(@"SPM_SMOKE_FAILED: bridge missing"); return 1; }
        SEL invoke = NSSelectorFromString(@"invoke:payload:");
        NSString *response = ((id (*)(id, SEL, id, id))objc_msgSend)(bridge, invoke,
            @"sdk.configure", @"{\"datakitUrl\":\"http://127.0.0.1:9\"}");
        NSLog(@"SPM_SMOKE_INIT: %@", response);
        NSDictionary *result = [NSJSONSerialization JSONObjectWithData:[response dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
        if (![result[@"ok"] boolValue]) return 4;
        Class configClass = NSClassFromString(@"FTSessionReplayConfig");
        id config = [[configClass alloc] init];
        if (![config respondsToSelector:NSSelectorFromString(@"setExternalRecorderMode:")]) return 2;
        Class replayClass = NSClassFromString(@"FTRumSessionReplay");
        id replay = ((id (*)(id, SEL))objc_msgSend)(replayClass, NSSelectorFromString(@"sharedInstance"));
        for (NSString *name in @[@"currentExternalRUMContext", @"saveExternalImageResourceData:mimeType:",
                                  @"writeExternalSegment:viewID:", @"setExternalRecordCountForViewID:count:",
                                  @"setExternalRecorderActive:"]) {
            if (![replay respondsToSelector:NSSelectorFromString(name)]) return 3;
        }
        ((id (*)(id, SEL, id, id))objc_msgSend)(bridge, invoke, @"sdk.shutdown", @"{}");
        NSLog(@"SPM_SMOKE_OK");
        return 0;
    }
}
