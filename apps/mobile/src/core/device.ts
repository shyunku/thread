import { NativeModules, Platform } from 'react-native';

// Samsung reports a model code (Build.MODEL "SM-S948N"); the market name reads better as the
// default device name. Keyed by the code without its region letter. Codes not listed fall back
// to "Samsung SM-…" (the user can rename the device).
const GALAXY: Record<string, string> = {
  'SM-S901': 'Galaxy S22',
  'SM-S906': 'Galaxy S22+',
  'SM-S908': 'Galaxy S22 Ultra',
  'SM-S911': 'Galaxy S23',
  'SM-S916': 'Galaxy S23+',
  'SM-S918': 'Galaxy S23 Ultra',
  'SM-S711': 'Galaxy S23 FE',
  'SM-S921': 'Galaxy S24',
  'SM-S926': 'Galaxy S24+',
  'SM-S928': 'Galaxy S24 Ultra',
  'SM-S721': 'Galaxy S24 FE',
  'SM-S931': 'Galaxy S25',
  'SM-S936': 'Galaxy S25+',
  'SM-S937': 'Galaxy S25 Edge',
  'SM-S938': 'Galaxy S25 Ultra',
  'SM-S731': 'Galaxy S25 FE',
  'SM-S948': 'Galaxy S26 Ultra',
  'SM-F721': 'Galaxy Z Flip4',
  'SM-F936': 'Galaxy Z Fold4',
  'SM-F731': 'Galaxy Z Flip5',
  'SM-F946': 'Galaxy Z Fold5',
  'SM-F741': 'Galaxy Z Flip6',
  'SM-F956': 'Galaxy Z Fold6',
  'SM-F761': 'Galaxy Z Flip7 FE',
  'SM-F766': 'Galaxy Z Flip7',
  'SM-F966': 'Galaxy Z Fold7',
  'SM-A155': 'Galaxy A15',
  'SM-A156': 'Galaxy A15 5G',
  'SM-A165': 'Galaxy A16',
  'SM-A166': 'Galaxy A16 5G',
  'SM-A256': 'Galaxy A25',
  'SM-A266': 'Galaxy A26',
  'SM-A346': 'Galaxy A34',
  'SM-A356': 'Galaxy A35',
  'SM-A366': 'Galaxy A36',
  'SM-A546': 'Galaxy A54',
  'SM-A556': 'Galaxy A55',
  'SM-A566': 'Galaxy A56',
};

// The readable name for a raw model: a known Galaxy code by its market name, any other Samsung
// code as "Samsung SM-…", everything else (e.g. "Pixel 9") as it is.
export function modelName(raw: string): string {
  const model = raw.trim();
  const code = model
    .toUpperCase()
    .replace(/_/g, '-')
    .match(/^SM-[A-Z]\d{3}/)?.[0];
  if (!code) return model;
  return GALAXY[code] ?? `Samsung ${model.toUpperCase().replace(/_/g, '-')}`;
}

// This phone's default name (#77): its model as the OS reports it (Android Build.MODEL, Galaxy
// codes mapped to market names; iOS UIDevice.model). Never the user-set device name, which is
// often personal.
export function deviceModel(): string {
  try {
    const model = NativeModules.ThreadBootInfo?.getModel?.();
    if (typeof model === 'string' && model.trim()) return modelName(model);
  } catch {}
  return Platform.OS === 'ios' ? 'iPhone' : 'Android 휴대폰';
}
