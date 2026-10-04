/**
 * @format
 */

import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders the placeholder home screen', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });
  expect(JSON.stringify(tree!.toJSON())).toContain('Thread');
});
