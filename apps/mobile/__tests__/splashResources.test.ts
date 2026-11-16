/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { themes } from '@/ui/theme';

// The Android start-up (#112): the splash and the window background show the logo on the
// app canvas, at the size and place of the JS loading screen (128dp in the middle).
const res = path.join(__dirname, '../android/app/src/main/res');
const read = (file: string) => fs.readFileSync(path.join(res, file), 'utf8');
const color = (file: string) =>
  read(file).match(/name="splash_background">(#[0-9A-Fa-f]{6})</)?.[1].toLowerCase();

test('the splash colour is the app canvas, light and dark', () => {
  expect(color('values/splash.xml')).toBe(themes.light.canvas);
  expect(color('values-night/splash.xml')).toBe(themes.dark.canvas);
});

test('the window background draws the logo at 128dp in the middle', () => {
  const xml = read('drawable/splash_window.xml');
  expect(xml).toMatch(/android:width="128dp"/);
  expect(xml).toMatch(/android:height="128dp"/);
  expect(xml).toMatch(/android:gravity="center"/);
});

test('the Android 12+ splash icon leaves 128dp of its 288dp area (a fraction, not dp)', () => {
  const inset = read('drawable/splash_icon.xml').match(/android:inset="([^"]+)"/)?.[1];
  // A dp inset left only a dot on the API 36 emulator.
  expect(inset).toMatch(/%$/);
  expect(288 * (1 - (2 * parseFloat(inset!)) / 100)).toBeCloseTo(128, 0);
  const v31 = read('values-v31/styles.xml');
  expect(v31).toMatch(/windowSplashScreenAnimatedIcon">@drawable\/splash_icon</);
  expect(v31).toMatch(/windowSplashScreenBackground">@color\/splash_background</);
});
