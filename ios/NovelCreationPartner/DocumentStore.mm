#import "DocumentStore.h"
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <errno.h>

static const NSUInteger DocumentMaxBytes = 50 * 1024 * 1024;
static NSString *DocumentExportSession(void) {
  static NSString *session;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ session = NSUUID.UUID.UUIDString; });
  return session;
}
static BOOL DocumentStorageFull(NSError *error) {
  for (NSUInteger depth = 0; error && depth < 8; depth++, error = error.userInfo[NSUnderlyingErrorKey]) {
    if ([error.domain isEqualToString:NSCocoaErrorDomain] && error.code == NSFileWriteOutOfSpaceError) return YES;
    if ([error.domain isEqualToString:NSPOSIXErrorDomain] && (error.code == ENOSPC || error.code == EDQUOT)) return YES;
  }
  return NO;
}

@interface DocumentStore ()
@property(nonatomic, copy) RCTPromiseResolveBlock pickerResolve;
@property(nonatomic, copy) RCTPromiseRejectBlock pickerReject;
@property(nonatomic, weak) UIViewController *presentedController;
@property(nonatomic) BOOL invalidated;
@property(nonatomic) BOOL sharing;
@property(nonatomic, copy) RCTPromiseResolveBlock shareResolve;
@property(nonatomic, copy) RCTPromiseRejectBlock shareReject;
@property(nonatomic, strong) dispatch_queue_t fileQueue;
@end

@implementation DocumentStore
RCT_EXPORT_MODULE(DocumentStore)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (instancetype)init {
  if ((self = [super init])) _fileQueue = dispatch_queue_create("app.novel.document-files", DISPATCH_QUEUE_SERIAL);
  return self;
}
- (NSURL *)exportRoot {
  return [[NSFileManager.defaultManager URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject URLByAppendingPathComponent:@"document_exports" isDirectory:YES];
}
- (void)cleanupExports:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.fileQueue, ^{
    if (self.invalidated) { reject(@"DOCUMENT_UNAVAILABLE", @"Document operation stopped", nil); return; }
    NSFileManager *files = NSFileManager.defaultManager;
    NSURL *root = [self exportRoot];
    if (![files fileExistsAtPath:root.path]) { resolve(nil); return; }
    NSError *failure = nil;
    NSArray<NSURL *> *sessions = [files contentsOfDirectoryAtURL:root includingPropertiesForKeys:nil options:0 error:&failure];
    if (!sessions) { reject(@"DOCUMENT_UNAVAILABLE", @"Could not inspect export cache", nil); return; }
    for (NSURL *session in sessions) {
      if (![session.lastPathComponent isEqualToString:DocumentExportSession()] && ![files removeItemAtURL:session error:&failure]) {
        reject(@"DOCUMENT_UNAVAILABLE", @"Could not clean previous export files", nil); return;
      }
    }
    resolve(nil);
  });
}
- (NSString *)safeName:(NSString *)name {
  NSCharacterSet *invalid = [NSCharacterSet characterSetWithCharactersInString:@"/\\:*?\"<>|\n\r\t"];
  NSMutableString *result = [NSMutableString new];
  NSUInteger points = 0;
  for (NSUInteger i = 0; i < name.length && points < 120; i++, points++) {
    unichar c = [name characterAtIndex:i];
    if (CFStringIsSurrogateHighCharacter(c) && i + 1 < name.length && CFStringIsSurrogateLowCharacter([name characterAtIndex:i + 1])) {
      [result appendString:[name substringWithRange:NSMakeRange(i, 2)]]; i++; continue;
    }
    [result appendFormat:@"%C", (c < 32 || c == 127 || [invalid characterIsMember:c]) ? '_' : c];
  }
  while ([result hasPrefix:@"."]) [result deleteCharactersInRange:NSMakeRange(0, 1)];
  NSString *trimmed = [result stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  return trimmed.length ? trimmed : @"document";
}
- (UIViewController *)foregroundController {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (scene.activationState != UISceneActivationStateForegroundActive || ![scene isKindOfClass:UIWindowScene.class]) continue;
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      if (!window.isKeyWindow) continue;
      UIViewController *top = window.rootViewController;
      while (top.presentedViewController && !top.presentedViewController.isBeingDismissed) top = top.presentedViewController;
      return top;
    }
  }
  return nil;
}
- (void)pick:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *parent = [self foregroundController];
    if (self.invalidated || !parent) { reject(@"DOCUMENT_UNAVAILABLE", @"No foreground window", nil); return; }
    if (self.pickerResolve || self.sharing) { reject(@"DOCUMENT_BUSY", @"Another document interaction is open", nil); return; }
    self.pickerResolve = resolve; self.pickerReject = reject;
    UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:@[UTTypeData, UTTypeContent] asCopy:YES];
    picker.delegate = self; picker.allowsMultipleSelection = NO;
    self.presentedController = picker;
    [parent presentViewController:picker animated:YES completion:nil];
  });
}
- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
  RCTPromiseResolveBlock resolve = self.pickerResolve;
  self.pickerResolve = nil; self.pickerReject = nil; self.presentedController = nil;
  if (resolve) resolve(nil);
}
- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
  RCTPromiseResolveBlock resolve = self.pickerResolve;
  RCTPromiseRejectBlock reject = self.pickerReject;
  if (!resolve) return;
  NSURL *url = urls.firstObject;
  // Keep the operation reserved until the bounded background read completes.
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    BOOL access = [url startAccessingSecurityScopedResource];
    @try {
      if (!url || !url.isFileURL) @throw [NSException exceptionWithName:@"DocumentInvalid" reason:nil userInfo:nil];
      NSNumber *size = nil; [url getResourceValue:&size forKey:NSURLFileSizeKey error:nil];
      if (size && size.unsignedLongLongValue > DocumentMaxBytes) @throw [NSException exceptionWithName:@"DocumentLarge" reason:nil userInfo:nil];
      NSInputStream *stream = [NSInputStream inputStreamWithURL:url];
      if (!stream) @throw [NSException exceptionWithName:@"DocumentRead" reason:nil userInfo:nil];
      [stream open];
      NSMutableData *data = [NSMutableData new];
      uint8_t buffer[16384]; NSInteger count;
      @try {
        while ((count = [stream read:buffer maxLength:sizeof(buffer)]) > 0) {
          if (data.length + (NSUInteger)count > DocumentMaxBytes) @throw [NSException exceptionWithName:@"DocumentLarge" reason:nil userInfo:nil];
          [data appendBytes:buffer length:(NSUInteger)count];
        }
        if (count < 0 || stream.streamError) @throw [NSException exceptionWithName:@"DocumentRead" reason:nil userInfo:nil];
      } @finally { [stream close]; }
      NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"name": [self safeName:url.lastPathComponent], @"base64": [data base64EncodedStringWithOptions:0]} options:NSJSONWritingWithoutEscapingSlashes error:nil];
      NSString *result = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
      dispatch_async(dispatch_get_main_queue(), ^{
        if (!self.pickerResolve) return;
        self.pickerResolve = nil; self.pickerReject = nil; self.presentedController = nil;
        if (self.invalidated) reject(@"DOCUMENT_UNAVAILABLE", @"Document operation stopped", nil); else resolve(result);
      });
    } @catch (NSException *exception) {
      dispatch_async(dispatch_get_main_queue(), ^{
        if (!self.pickerResolve) return;
        self.pickerResolve = nil; self.pickerReject = nil; self.presentedController = nil;
        reject(@"DOCUMENT_INVALID", @"Could not read document within 50 MiB limit", nil);
      });
    } @finally { if (access) [url stopAccessingSecurityScopedResource]; }
  });
}
- (void)writeAndShare:(NSString *)name base64:(NSString *)base64 mime:(NSString *)mime resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSSet *allowed = [NSSet setWithArray:@[@"application/zip", @"application/json", @"text/plain", @"text/markdown", @"application/octet-stream"]];
  if (base64.length > ((DocumentMaxBytes + 2) / 3) * 4 || ![allowed containsObject:mime]) { reject(@"DOCUMENT_INVALID", @"Invalid document", nil); return; }
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.invalidated || ![self foregroundController]) { reject(@"DOCUMENT_UNAVAILABLE", @"No foreground window", nil); return; }
    if (self.sharing || self.pickerResolve) { reject(@"DOCUMENT_BUSY", @"Another document interaction is open", nil); return; }
    self.sharing = YES; self.shareResolve = resolve; self.shareReject = reject;
    dispatch_async(self.fileQueue, ^{
      NSData *data = [[NSData alloc] initWithBase64EncodedString:base64 options:0];
      if (!data || data.length > DocumentMaxBytes) { dispatch_async(dispatch_get_main_queue(), ^{ if (!self.shareResolve) return; self.sharing = NO; self.shareResolve = nil; self.shareReject = nil; reject(@"DOCUMENT_INVALID", @"File exceeds 50 MiB or invalid base64", nil); }); return; }
      NSFileManager *files = NSFileManager.defaultManager;
      NSURL *session = [[self exportRoot] URLByAppendingPathComponent:DocumentExportSession() isDirectory:YES];
      NSURL *folder = [session URLByAppendingPathComponent:NSUUID.UUID.UUIDString isDirectory:YES];
      NSURL *url = [folder URLByAppendingPathComponent:[self safeName:name] isDirectory:NO];
      NSError *failure = nil;
      BOOL prepared = [files createDirectoryAtURL:folder withIntermediateDirectories:YES attributes:@{NSFileProtectionKey: NSFileProtectionCompleteUntilFirstUserAuthentication} error:&failure]
        && [data writeToURL:url options:NSDataWritingAtomic | NSDataWritingFileProtectionComplete error:&failure];
      if (!prepared) {
        BOOL full = DocumentStorageFull(failure);
        [files removeItemAtURL:folder error:nil];
        dispatch_async(dispatch_get_main_queue(), ^{ if (!self.shareResolve) return; self.sharing = NO; self.shareResolve = nil; self.shareReject = nil; reject(full ? @"STORAGE_FULL" : @"DOCUMENT_UNAVAILABLE", full ? @"Not enough storage to generate export" : @"Could not write export", nil); }); return;
      }
      dispatch_async(dispatch_get_main_queue(), ^{
        if (!self.shareResolve) { [files removeItemAtURL:folder error:nil]; return; }
        UIViewController *parent = [self foregroundController];
        if (self.invalidated || !parent) { self.sharing = NO; self.shareResolve = nil; self.shareReject = nil; [files removeItemAtURL:folder error:nil]; reject(@"DOCUMENT_UNAVAILABLE", @"No foreground window", nil); return; }
        UIActivityViewController *share = [[UIActivityViewController alloc] initWithActivityItems:@[url] applicationActivities:nil];
        share.popoverPresentationController.sourceView = parent.view;
        share.popoverPresentationController.sourceRect = CGRectMake(CGRectGetMidX(parent.view.bounds), CGRectGetMidY(parent.view.bounds), 1, 1);
        share.completionWithItemsHandler = ^(UIActivityType activity, BOOL completed, NSArray *items, NSError *error) {
          if (!self.shareResolve) return;
          self.shareResolve = nil; self.shareReject = nil;
          self.sharing = NO; self.presentedController = nil;
          // Targets may still read after this callback; only the next process removes this session.
          if (error) reject(@"DOCUMENT_UNAVAILABLE", @"System share did not complete", nil); else resolve(completed ? @"completed" : @"cancelled");
        };
        self.presentedController = share;
        [parent presentViewController:share animated:YES completion:nil];
      });
    });
  });
}
- (void)invalidate {
  dispatch_async(dispatch_get_main_queue(), ^{
    self.invalidated = YES;
    RCTPromiseResolveBlock resolve = self.pickerResolve;
    self.pickerResolve = nil; self.pickerReject = nil;
    [self.presentedController dismissViewControllerAnimated:NO completion:nil];
    if (resolve) resolve(nil);
    RCTPromiseResolveBlock shareResolve = self.shareResolve;
    self.shareResolve = nil; self.shareReject = nil; self.sharing = NO;
    if (shareResolve) shareResolve(@"cancelled");
  });
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeDocumentStoreSpecJSI>(params);
}
@end
