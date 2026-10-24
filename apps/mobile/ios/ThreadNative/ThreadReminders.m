#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>

// Due reminders (#91), the iOS side of the Android ReminderModule: replace the schedule (local
// notifications, at most 64 pending per app), report and ask for the permission, and hand over
// the task a notification tap opened. Titles of secret tasks never get here (the app plans them
// without one).

static NSString *const kPrefix = @"thread-reminder:";
static NSString *const kOpenEvent = @"ThreadReminderOpen";
static NSString *gOpened = nil;
static __weak RCTEventEmitter *gEmitter = nil;

@interface ThreadReminderDelegate : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation ThreadReminderDelegate

+ (instancetype)shared
{
  static ThreadReminderDelegate *delegate;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ delegate = [ThreadReminderDelegate new]; });
  return delegate;
}

// The delegate has to be set before the app finishes launching to get the tap that launched it.
+ (void)load
{
  [UNUserNotificationCenter currentNotificationCenter].delegate = [self shared];
}

// Shown while the app is open too.
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler
{
  completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | UNNotificationPresentationOptionSound);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
         withCompletionHandler:(void (^)(void))completionHandler
{
  id tid = response.notification.request.content.userInfo[@"tid"];
  if ([tid isKindOfClass:[NSString class]] && [response.notification.request.identifier hasPrefix:kPrefix]) {
    gOpened = tid;
    RCTEventEmitter *emitter = gEmitter;
    if (emitter) [emitter sendEventWithName:kOpenEvent body:tid];
  }
  completionHandler();
}

@end

@interface ThreadReminders : RCTEventEmitter <RCTBridgeModule>
@end

@implementation ThreadReminders

RCT_EXPORT_MODULE(ThreadReminders)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if ((self = [super init])) gEmitter = self;
  return self;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ kOpenEvent ];
}

RCT_EXPORT_METHOD(schedule:(NSString *)json)
{
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  NSArray *items = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if (![items isKindOfClass:[NSArray class]]) return;
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center getPendingNotificationRequestsWithCompletionHandler:^(NSArray<UNNotificationRequest *> *pending) {
    NSMutableArray *ours = [NSMutableArray array];
    for (UNNotificationRequest *request in pending)
      if ([request.identifier hasPrefix:kPrefix]) [ours addObject:request.identifier];
    [center removePendingNotificationRequestsWithIdentifiers:ours];
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970] * 1000;
    NSUInteger count = 0;
    for (NSDictionary *item in items) {
      if (count >= 64) break;
      if (![item isKindOfClass:[NSDictionary class]]) continue;
      NSString *ident = item[@"id"], *tid = item[@"tid"], *title = item[@"title"], *body = item[@"body"];
      NSNumber *at = item[@"at"];
      if (![ident isKindOfClass:[NSString class]] || ![tid isKindOfClass:[NSString class]] || ![at isKindOfClass:[NSNumber class]]) continue;
      NSTimeInterval wait = (at.doubleValue - now) / 1000;
      if (wait < 1) continue;
      UNMutableNotificationContent *content = [UNMutableNotificationContent new];
      content.title = [title isKindOfClass:[NSString class]] ? title : @"";
      content.body = [body isKindOfClass:[NSString class]] ? body : @"";
      content.sound = [UNNotificationSound defaultSound];
      content.userInfo = @{ @"tid" : tid };
      UNTimeIntervalNotificationTrigger *trigger = [UNTimeIntervalNotificationTrigger triggerWithTimeInterval:wait repeats:NO];
      [center addNotificationRequest:[UNNotificationRequest requestWithIdentifier:[kPrefix stringByAppendingString:ident] content:content trigger:trigger] withCompletionHandler:nil];
      count++;
    }
  }];
}

RCT_EXPORT_METHOD(status:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  [[UNUserNotificationCenter currentNotificationCenter] getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    UNAuthorizationStatus s = settings.authorizationStatus;
    resolve(@{
      @"enabled" : @(s == UNAuthorizationStatusAuthorized || s == UNAuthorizationStatusProvisional),
      @"asked" : @(s != UNAuthorizationStatusNotDetermined),
      @"exact" : @YES,
    });
  }];
}

RCT_EXPORT_METHOD(requestPermission:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  [[UNUserNotificationCenter currentNotificationCenter]
      requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound)
                    completionHandler:^(BOOL granted, NSError *error) { resolve(@(granted)); }];
}

RCT_EXPORT_METHOD(openNotificationSettings)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSString *target = UIApplicationOpenSettingsURLString;
    if (@available(iOS 16.0, *)) target = UIApplicationOpenNotificationSettingsURLString;
    [[UIApplication sharedApplication] openURL:[NSURL URLWithString:target] options:@{} completionHandler:nil];
  });
}

RCT_EXPORT_METHOD(openExactAlarmSettings)
{
  // iOS delivers local notifications on time; nothing to open.
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(takeOpenedTask)
{
  NSString *tid = gOpened;
  gOpened = nil;
  return tid;
}

@end
