#import "CoverStore.h"
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

static const NSUInteger CoverLimit = 30 * 1024 * 1024;
@interface CoverStore ()
@property(nonatomic, copy) RCTPromiseResolveBlock pickerResolve;
@property(nonatomic, copy) RCTPromiseRejectBlock pickerReject;
@property(nonatomic, weak) PHPickerViewController *picker;
@property(atomic) BOOL stopped;
@property(nonatomic, strong) dispatch_queue_t filesQueue;
@end

@implementation CoverStore
RCT_EXPORT_MODULE(CoverStore)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (instancetype)init { if ((self = [super init])) _filesQueue = dispatch_queue_create("novel.private.covers", DISPATCH_QUEUE_SERIAL); return self; }
- (NSURL *)root {
  NSURL *root = [[NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject URLByAppendingPathComponent:@"covers" isDirectory:YES];
  NSError *error = nil;
  if (![NSFileManager.defaultManager createDirectoryAtURL:root withIntermediateDirectories:YES attributes:@{NSFileProtectionKey:NSFileProtectionCompleteUntilFirstUserAuthentication} error:&error]) @throw [NSException exceptionWithName:@"CoverWrite" reason:nil userInfo:nil];
  [root setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
  return root;
}
- (NSURL *)file:(NSString *)token {
  NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" options:0 error:nil];
  if ([pattern numberOfMatchesInString:token options:0 range:NSMakeRange(0,token.length)] != 1) @throw [NSException exceptionWithName:@"CoverFormat" reason:nil userInfo:nil];
  return [[self root] URLByAppendingPathComponent:[token stringByAppendingString:@".jpg"]];
}
- (NSString *)normalize:(NSData *)data {
  if (!data || data.length > CoverLimit) @throw [NSException exceptionWithName:data.length > CoverLimit ? @"CoverLarge" : @"CoverFormat" reason:nil userInfo:nil];
  CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
  if (!source) @throw [NSException exceptionWithName:@"CoverFormat" reason:nil userInfo:nil];
  CGImageRef image = CGImageSourceCreateThumbnailAtIndex(source,0,(__bridge CFDictionaryRef)@{(id)kCGImageSourceCreateThumbnailFromImageAlways:@YES,(id)kCGImageSourceCreateThumbnailWithTransform:@YES,(id)kCGImageSourceThumbnailMaxPixelSize:@1200});
  CFRelease(source);
  if (!image) @throw [NSException exceptionWithName:@"CoverFormat" reason:nil userInfo:nil];
  NSString *token = NSUUID.UUID.UUIDString.lowercaseString;
  NSURL *url = [self file:token]; NSURL *temporary = [[self root] URLByAppendingPathComponent:[token stringByAppendingString:@".tmp"]];
  CGImageDestinationRef destination = CGImageDestinationCreateWithURL((__bridge CFURLRef)temporary,(__bridge CFStringRef)UTTypeJPEG.identifier,1,NULL);
  if (!destination) { CGImageRelease(image); @throw [NSException exceptionWithName:@"CoverWrite" reason:nil userInfo:nil]; }
  // Thumbnail transform preserves orientation; no source properties/EXIF are copied to the JPEG.
  CGImageDestinationAddImage(destination,image,(__bridge CFDictionaryRef)@{(id)kCGImageDestinationLossyCompressionQuality:@0.85});
  BOOL encoded = CGImageDestinationFinalize(destination); CFRelease(destination); CGImageRelease(image);
  NSError *failure = nil;
  if (!encoded || self.stopped || ![NSFileManager.defaultManager moveItemAtURL:temporary toURL:url error:&failure]) {
    [NSFileManager.defaultManager removeItemAtURL:temporary error:nil];
    @throw [NSException exceptionWithName:failure.code == NSFileWriteOutOfSpaceError ? @"StorageFull" : @"CoverWrite" reason:nil userInfo:nil];
  }
  [NSFileManager.defaultManager setAttributes:@{NSFileProtectionKey:NSFileProtectionCompleteUntilFirstUserAuthentication} ofItemAtPath:url.path error:nil];
  NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"token":token,@"uri":url.absoluteString} options:NSJSONWritingWithoutEscapingSlashes error:nil];
  return [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
}
- (void)reject:(RCTPromiseRejectBlock)reject exception:(NSException *)error {
  NSString *code = [error.name isEqualToString:@"CoverLarge"] ? @"COVER_LARGE" : [error.name isEqualToString:@"StorageFull"] ? @"STORAGE_FULL" : @"COVER_FORMAT";
  reject(code,@"Could not process selected image",nil);
}
- (UIViewController *)foreground {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) if (scene.activationState == UISceneActivationStateForegroundActive && [scene isKindOfClass:UIWindowScene.class]) {
    for (UIWindow *window in ((UIWindowScene *)scene).windows) if (window.isKeyWindow) {
      UIViewController *top = window.rootViewController;
      while (top.presentedViewController && !top.presentedViewController.isBeingDismissed) top = top.presentedViewController;
      return top;
    }
  }
  return nil;
}
- (void)pick:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *parent = [self foreground];
    if (self.stopped || !parent) { reject(@"COVER_UNAVAILABLE",@"No foreground window",nil); return; }
    if (self.pickerResolve) { reject(@"COVER_BUSY",@"Photo picker already open",nil); return; }
    self.pickerResolve = resolve; self.pickerReject = reject;
    PHPickerConfiguration *configuration = [[PHPickerConfiguration alloc] init];
    configuration.selectionLimit = 1; configuration.filter = PHPickerFilter.imagesFilter;
    configuration.preferredAssetRepresentationMode = PHPickerConfigurationAssetRepresentationModeCurrent;
    PHPickerViewController *picker = [[PHPickerViewController alloc] initWithConfiguration:configuration];
    picker.delegate = self; self.picker = picker; [parent presentViewController:picker animated:YES completion:nil];
  });
}
- (void)picker:(PHPickerViewController *)picker didFinishPicking:(NSArray<PHPickerResult *> *)results {
  RCTPromiseResolveBlock resolve = self.pickerResolve; RCTPromiseRejectBlock reject = self.pickerReject;
  if (!resolve) return;
  [picker dismissViewControllerAnimated:YES completion:^{
    if (!results.count) { self.pickerResolve = nil; self.pickerReject = nil; self.picker = nil; resolve(nil); return; }
    [results.firstObject.itemProvider loadFileRepresentationForTypeIdentifier:UTTypeImage.identifier completionHandler:^(NSURL *url, NSError *error) {
      // Provider's temporary URL exists only during this completion. Copy bounded bytes before returning.
      NSData *data = nil; __block NSString *result = nil; __block NSException *failure = nil;
      @try {
        if (!url.isFileURL || error || self.stopped) @throw [NSException exceptionWithName:@"CoverRead" reason:nil userInfo:nil];
        NSNumber *size = nil; [url getResourceValue:&size forKey:NSURLFileSizeKey error:nil];
        if (size.unsignedLongLongValue > CoverLimit) @throw [NSException exceptionWithName:@"CoverLarge" reason:nil userInfo:nil];
        NSInputStream *stream = [NSInputStream inputStreamWithURL:url]; NSMutableData *bytes = [NSMutableData new]; [stream open];
        @try { uint8_t buffer[16384]; NSInteger count;
          while ((count = [stream read:buffer maxLength:sizeof(buffer)]) > 0) { if (bytes.length + count > CoverLimit) @throw [NSException exceptionWithName:@"CoverLarge" reason:nil userInfo:nil]; [bytes appendBytes:buffer length:count]; }
          if (count < 0 || stream.streamError) @throw [NSException exceptionWithName:@"CoverRead" reason:nil userInfo:nil];
        } @finally { [stream close]; }
        data = bytes;
        dispatch_sync(self.filesQueue, ^{ @try { result = [self normalize:data]; } @catch (NSException *exception) { failure = exception; } });
      } @catch (NSException *exception) { failure = exception; }
      dispatch_async(dispatch_get_main_queue(), ^{
        if (!self.pickerResolve) return;
        self.pickerResolve = nil; self.pickerReject = nil; self.picker = nil;
        if (failure) [self reject:reject exception:failure]; else resolve(result);
      });
    }];
  }];
}
- (void)importImage:(NSString *)base64 resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.filesQueue, ^{
    @try { if (self.stopped) @throw [NSException exceptionWithName:@"CoverRead" reason:nil userInfo:nil];
      if (base64.length > ((CoverLimit + 2) / 3) * 4) @throw [NSException exceptionWithName:@"CoverLarge" reason:nil userInfo:nil];
      resolve([self normalize:[[NSData alloc] initWithBase64EncodedString:base64 options:0]]);
    } @catch (NSException *error) { [self reject:reject exception:error]; }
  });
}
- (void)read:(NSString *)token resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.filesQueue, ^{
    @try { NSURL *url = [self file:token]; NSNumber *size = nil; [url getResourceValue:&size forKey:NSURLFileSizeKey error:nil];
      if (size.unsignedLongLongValue > CoverLimit) @throw [NSException exceptionWithName:@"CoverLarge" reason:nil userInfo:nil];
      NSData *data = [NSData dataWithContentsOfURL:url]; if (!data || self.stopped) @throw [NSException exceptionWithName:@"CoverRead" reason:nil userInfo:nil];
      NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"base64":[data base64EncodedStringWithOptions:0],@"mimeType":@"image/jpeg"} options:NSJSONWritingWithoutEscapingSlashes error:nil]; resolve([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]);
    } @catch (NSException *error) { [self reject:reject exception:error]; }
  });
}
- (void)remove:(NSString *)token resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.filesQueue, ^{
    @try { NSURL *url = [self file:token]; NSError *error = nil; if ([NSFileManager.defaultManager fileExistsAtPath:url.path] && ![NSFileManager.defaultManager removeItemAtURL:url error:&error]) @throw [NSException exceptionWithName:@"CoverWrite" reason:nil userInfo:nil]; resolve(nil); }
    @catch (NSException *error) { [self reject:reject exception:error]; }
  });
}
- (void)prune:(NSString *)keepTokensJson resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.filesQueue, ^{
    @try { NSArray *tokens = [NSJSONSerialization JSONObjectWithData:[keepTokensJson dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]; if (![tokens isKindOfClass:NSArray.class]) @throw [NSException exceptionWithName:@"CoverFormat" reason:nil userInfo:nil];
      NSMutableSet *keep = [NSMutableSet new]; for (NSString *token in tokens) [keep addObject:[self file:token].lastPathComponent];
      for (NSURL *url in [NSFileManager.defaultManager contentsOfDirectoryAtURL:[self root] includingPropertiesForKeys:@[NSURLContentModificationDateKey] options:0 error:nil]) {
        NSDate *modified = nil; [url getResourceValue:&modified forKey:NSURLContentModificationDateKey error:nil]; if (![keep containsObject:url.lastPathComponent] && modified && modified.timeIntervalSinceNow < -86400) [NSFileManager.defaultManager removeItemAtURL:url error:nil];
      } resolve(nil);
    } @catch (NSException *error) { [self reject:reject exception:error]; }
  });
}
- (void)invalidate { self.stopped = YES; dispatch_async(dispatch_get_main_queue(), ^{ RCTPromiseResolveBlock resolve = self.pickerResolve; self.pickerResolve = nil; self.pickerReject = nil; [self.picker dismissViewControllerAnimated:NO completion:nil]; self.picker = nil; if (resolve) resolve(nil); }); }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params { return std::make_shared<facebook::react::NativeCoverStoreSpecJSI>(params); }
@end
