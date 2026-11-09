import {
  answered,
  asking,
  lastAnswer,
  refused,
  UNASKED,
  type Listing,
} from './host-listing';
import type { Session } from '@/tmux/tmux-client';

const running = (name: string, windowCount = 1): Session => ({ name, windowCount });

describe('what the Host last said', () => {
  it('has nothing to show before the first answer', () => {
    expect(lastAnswer(UNASKED)).toBeUndefined();
  });

  it('keeps the last answer while the next question is in flight', () => {
    // The whole point. The Host Screen asks again every time it comes back
    // into focus — closing the Edit sheet, closing New Session, coming Home
    // from the Terminal Screen — and dropping what it had is what made every
    // one of those flash the list, the count and the window counts off and on
    // again.
    const read = answered([running('alpha'), running('beta')]);
    const again = asking(read);

    expect(lastAnswer(again)).toEqual([running('alpha'), running('beta')]);
  });

  it('holds the answer across any number of questions', () => {
    let listing: Listing = answered([running('alpha')]);
    for (let asked = 0; asked < 5; asked += 1) listing = asking(listing);

    expect(lastAnswer(listing)).toEqual([running('alpha')]);
  });

  it('takes the new answer over the one it was holding', () => {
    const listing = answered([running('beta')]);

    expect(lastAnswer(answered([running('gamma')]))).toEqual([running('gamma')]);
    expect(lastAnswer(listing)).toEqual([running('beta')]);
  });

  it('drops the list when the Host refuses, rather than offering Sessions twice', () => {
    // Deliberately not held. A Host that cannot be reached has no Sessions to
    // offer, and the last ones left on screen under an error would be an offer
    // to open something that may not be there.
    const refusal = refused('The Host could not be reached.');

    expect(lastAnswer(refusal)).toBeUndefined();
    expect(lastAnswer(asking(refusal))).toBeUndefined();
  });
});
