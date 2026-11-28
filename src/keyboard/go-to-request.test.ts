import { requestGoTo, takeGoToRequest } from './go-to-request';

it('gives Go to one time to the Host Screen of the Host that the screen named, with the screen to go back to', () => {
  expect(takeGoToRequest('mac')).toBeNull();

  requestGoTo('mac', { kind: 'terminal' });

  expect(takeGoToRequest('linux')).toBeNull();
  expect(takeGoToRequest('mac')).toEqual({ kind: 'terminal' });
  expect(takeGoToRequest('mac')).toBeNull();
});
