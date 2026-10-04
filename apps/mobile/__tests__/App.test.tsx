/**
 * @format
 */

import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// The dev-only E2EE self-test runs real crypto; not part of this render check.
jest.mock('@/screens/dev/VaultHarness', () => () => null);
jest.mock('@/core/e2ee/selfTest', () => ({
  runE2eeSelfTest: () => Promise.resolve([]),
}));

test('renders the placeholder home screen', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });
  expect(JSON.stringify(tree!.toJSON())).toContain('Thread');
});
