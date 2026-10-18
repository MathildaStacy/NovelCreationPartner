#import "AppInfo.h"

// Read metadata only, never follow symlinks or accept a path from JavaScript.
static BOOL NCPStorageBytes(NSURL *url, unsigned long long *bytes) {
  NSError *error = nil;
  NSFileManager *files = NSFileManager.defaultManager;
  NSDictionary *attributes = [files attributesOfItemAtPath:url.path error:&error];
  if (!attributes) {
    return [error.domain isEqualToString:NSCocoaErrorDomain] &&
      (error.code == NSFileNoSuchFileError || error.code == NSFileReadNoSuchFileError);
  }
  NSString *type = attributes[NSFileType];
  if ([type isEqualToString:NSFileTypeRegular]) {
    unsigned long long size = [attributes[NSFileSize] unsignedLongLongValue];
    if (size > 9007199254740991ULL - *bytes) return NO;
    *bytes += size;
  } else if ([type isEqualToString:NSFileTypeDirectory]) {
    NSArray<NSURL *> *children = [files contentsOfDirectoryAtURL:url includingPropertiesForKeys:nil options:0 error:&error];
    if (!children) return NO;
    for (NSURL *child in children) if (!NCPStorageBytes(child, bytes)) return NO;
  }
  return YES;
}

@implementation AppInfo
RCT_EXPORT_MODULE(AppInfo)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (void)getInfo:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSDictionary *info = NSBundle.mainBundle.infoDictionary;
#if DEBUG
  BOOL debug = YES;
#else
  BOOL debug = NO;
#endif
  NSDictionary *value = @{@"version": info[@"CFBundleShortVersionString"] ?: @"",
                          @"build": info[@"CFBundleVersion"] ?: @"", @"debug": @(debug)};
  NSData *json = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  if (json) resolve([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]);
  else reject(@"APP_INFO", @"Build metadata unavailable", nil);
}
- (void)getStorageUsage:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    NSFileManager *files = NSFileManager.defaultManager;
    NSURL *library = [files URLsForDirectory:NSLibraryDirectory inDomains:NSUserDomainMask].firstObject;
    NSURL *support = [files URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
    NSURL *cache = [files URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject;
    unsigned long long dbBytes = 0, coverBytes = 0, cacheBytes = 0;
    BOOL valid = library && support && cache;
    for (NSString *name in @[@"novel.db", @"novel.db-wal", @"novel.db-shm"])
      if (valid) valid = NCPStorageBytes([library URLByAppendingPathComponent:name], &dbBytes);
    if (valid) valid = NCPStorageBytes([support URLByAppendingPathComponent:@"covers" isDirectory:YES], &coverBytes)
      && NCPStorageBytes(cache, &cacheBytes) && dbBytes + coverBytes + cacheBytes <= 9007199254740991ULL;
    if (!valid) { reject(@"STORAGE_USAGE", @"Storage usage unavailable", nil); return; }
    NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"db": @(dbBytes), @"covers": @(coverBytes), @"cache": @(cacheBytes)} options:0 error:nil];
    if (json) resolve([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]);
    else reject(@"STORAGE_USAGE", @"Storage usage unavailable", nil);
  });
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeAppInfoSpecJSI>(params);
}
@end
