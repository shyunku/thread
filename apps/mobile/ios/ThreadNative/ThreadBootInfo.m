#import <React/RCTBridgeModule.h>
#include <sys/sysctl.h>

// Identifies the current device boot so the vault asks for authentication again
// after a reboot (and only then, apart from a manual lock). Same contract as the
// Android BootInfoModule. Boot time is a required-reason API (PrivacyInfo 35F9.1).
@interface ThreadBootInfo : NSObject <RCTBridgeModule>
@end

@implementation ThreadBootInfo

RCT_EXPORT_MODULE(ThreadBootInfo)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(getBootId)
{
  struct timeval boottime;
  size_t size = sizeof(boottime);
  int mib[2] = {CTL_KERN, KERN_BOOTTIME};
  if (sysctl(mib, 2, &boottime, &size, NULL, 0) != 0 || boottime.tv_sec == 0) {
    return @"time:unknown";
  }
  // Rounded to a minute like the Android fallback.
  return [NSString stringWithFormat:@"time:%ld", (long)(boottime.tv_sec / 60)];
}

@end
