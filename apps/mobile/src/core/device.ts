import { NativeModules, Platform } from 'react-native';

// This phone's default name (#77): its model as the OS reports it (Android Build.MODEL,
// iOS UIDevice.model). Never the user-set device name, which is often personal.
export function deviceModel(): string {
  try {
    const model = NativeModules.ThreadBootInfo?.getModel?.();
    if (typeof model === 'string' && model.trim()) return model.trim();
  } catch {}
  return Platform.OS === 'ios' ? 'iPhone' : 'Android 휴대폰';
}
