import { installE2eePlatform } from './platform';

// Development check that the native crypto on this device reproduces the desktop
// fixtures (packages/e2ee/test). Remove once real E2EE screens cover it (#85, #86).
export async function runE2eeSelfTest(): Promise<string[]> {
  installE2eePlatform();
  const { runConformance } = require('@thread/e2ee/test/conformance');
  return runConformance();
}
