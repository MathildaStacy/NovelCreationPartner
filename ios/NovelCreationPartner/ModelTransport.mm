#import "ModelTransport.h"

// One ephemeral session per physical request. No shared cookies, caches,
// credential storage, interceptors or raw-error logging.
@interface ModelRequest : NSObject <NSURLSessionDataDelegate>
@property(nonatomic, strong) NSURLSession *session;
@property(nonatomic, strong) NSURLSessionDataTask *task;
@property(nonatomic, copy) void (^event)(NSDictionary *);
@property(nonatomic) BOOL ended;
@property(nonatomic) NSUInteger received;
- (void)finish:(NSString *)kind code:(NSString *)code;
@end

@implementation ModelRequest
- (void)send:(NSString *)kind status:(NSInteger)status headers:(NSString *)headers data:(NSString *)data code:(NSString *)code {
  if (self.event) self.event(@{@"kind": kind, @"status": @(status), @"headers": headers,
                               @"data": data, @"code": code});
}
- (void)finish:(NSString *)kind code:(NSString *)code {
  @synchronized(self) {
    if (self.ended) return;
    self.ended = YES;
    [self send:kind status:0 headers:@"{}" data:@"" code:code];
    self.event = nil;
    [self.session invalidateAndCancel];
    self.session = nil;
    self.task = nil;
  }
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task
    willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request
    completionHandler:(void (^)(NSURLRequest *_Nullable))completionHandler {
  completionHandler(nil); // Refuse BEFORE a second request can carry the Key.
  [self finish:@"error" code:@"redirect"];
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task
    didReceiveResponse:(NSURLResponse *)response
    completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
  NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
  @synchronized(self) {
    if (self.ended) { completionHandler(NSURLSessionResponseCancel); return; }
    if (![http isKindOfClass:NSHTTPURLResponse.class] || (http.statusCode >= 300 && http.statusCode < 400)) {
      completionHandler(NSURLSessionResponseCancel);
      [self finish:@"error" code:@"redirect"];
      return;
    }
    NSMutableDictionary *safe = [NSMutableDictionary new];
    for (NSString *name in @[@"content-type", @"retry-after", @"retry-after-ms", @"x-should-retry"]) {
      NSString *value = [http valueForHTTPHeaderField:name];
      if (value) safe[name] = value;
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:safe options:0 error:nil];
    [self send:@"headers" status:http.statusCode
        headers:[[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]
        data:@"" code:@""];
    completionHandler(NSURLSessionResponseAllow);
  }
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
  @synchronized(self) {
    if (self.ended) return;
    self.received += data.length;
    if (self.received > 16 * 1024 * 1024) {
      [self finish:@"error" code:@"too_large"];
      return;
    }
    [self send:@"data" status:0 headers:@"{}" data:[data base64EncodedStringWithOptions:0] code:@""];
  }
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
  [self finish:error ? @"error" : @"complete" code:error ? @"network" : @""];
}
@end

@implementation ModelTransport {
  NSMutableDictionary<NSString *, ModelRequest *> *_requests;
}
RCT_EXPORT_MODULE(ModelTransport)

- (instancetype)init {
  if ((self = [super init])) _requests = [NSMutableDictionary new];
  return self;
}
- (void)start:(NSString *)requestId url:(NSString *)url method:(NSString *)method headers:(NSString *)headers body:(NSString *)body {
  ModelRequest *holder = [ModelRequest new];
  @synchronized(self) {
    if (_requests[requestId]) return;
    _requests[requestId] = holder;
  }
  __weak ModelTransport *weakSelf = self;
  holder.event = ^(NSDictionary *payload) {
    ModelTransport *owner = weakSelf;
    if (!owner) return;
    NSMutableDictionary *event = [payload mutableCopy];
    event[@"requestId"] = requestId;
    [owner emitOnEvent:event];
    if ([@[@"complete", @"error", @"cancelled"] containsObject:payload[@"kind"]]) {
      @synchronized(owner) { [owner->_requests removeObjectForKey:requestId]; }
    }
  };
  NSURL *endpoint = [NSURL URLWithString:url];
  NSDictionary *fields = [NSJSONSerialization JSONObjectWithData:[headers dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if (!endpoint.host || ![@[@"http", @"https"] containsObject:endpoint.scheme] ||
      ![@[@"GET", @"POST"] containsObject:method] || ![fields isKindOfClass:NSDictionary.class]) {
    [holder finish:@"error" code:@"network"]; return;
  }
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:endpoint
      cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:90];
  request.HTTPMethod = method;
  request.HTTPShouldHandleCookies = NO;
  NSArray *allowed = @[@"authorization", @"x-api-key", @"anthropic-version", @"content-type", @"accept"];
  for (NSString *name in fields) {
    id value = fields[name];
    if (![allowed containsObject:name.lowercaseString] || ![value isKindOfClass:NSString.class] ||
        [value rangeOfCharacterFromSet:NSCharacterSet.newlineCharacterSet].location != NSNotFound) {
      [holder finish:@"error" code:@"network"]; return;
    }
    [request setValue:value forHTTPHeaderField:name];
  }
  [request setValue:@"no-store" forHTTPHeaderField:@"Cache-Control"];
  if ([method isEqualToString:@"POST"]) request.HTTPBody = [body dataUsingEncoding:NSUTF8StringEncoding];
  NSURLSessionConfiguration *config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
  config.HTTPCookieStorage = nil;
  config.HTTPCookieAcceptPolicy = NSHTTPCookieAcceptPolicyNever;
  config.HTTPShouldSetCookies = NO;
  config.URLCache = nil;
  config.URLCredentialStorage = nil;
  config.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
  config.timeoutIntervalForRequest = 90;
  config.timeoutIntervalForResource = 300;
  holder.session = [NSURLSession sessionWithConfiguration:config delegate:holder delegateQueue:nil];
  holder.task = [holder.session dataTaskWithRequest:request];
  @synchronized(holder) {
    if (!holder.ended) [holder.task resume];
    else [holder.session invalidateAndCancel];
  }
}
- (void)abort:(NSString *)requestId {
  ModelRequest *holder;
  @synchronized(self) { holder = _requests[requestId]; }
  [holder finish:@"cancelled" code:@""];
}
- (void)invalidate {
  NSArray<ModelRequest *> *pending;
  @synchronized(self) { pending = _requests.allValues; }
  for (ModelRequest *holder in pending) [holder finish:@"cancelled" code:@""];
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeModelTransportSpecJSI>(params);
}
@end
