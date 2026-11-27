import { answered, ask, cancel, failed, isPending, release, retry, seed, unasked, type HostRead } from './host-read';

type Read = HostRead<string, string[]>;

const shown = (key: string, ...data: string[]): Read => answered(ask(unasked(), key, 0), 1, data, false);

describe('a Host Read', () => {
  it('is pending from the ask, and keeps the last answer on screen', () => {
    const read = ask(shown('', 'muxify', 'dotfiles'), 'm', 5);
    expect(isPending(read)).toBe(true);
    expect(read.pending).toEqual({ key: 'm', since: 5 });
    expect(read.answer).toEqual({ key: '', data: ['muxify', 'dotfiles'] });
  });

  it('shows an answer only when it is for the newest ask', () => {
    const first = ask(shown(''), 'm', 0);
    const second = ask(first, 'mu', 0);
    expect(answered(second, first.ticket, ['old'], false)).toBe(second);
    expect(failed(second, first.ticket, 'gone')).toBe(second);
    expect(answered(second, second.ticket, ['muxify'], false)).toMatchObject({ pending: null, answer: { key: 'mu', data: ['muxify'] } });
  });

  it('keeps the failure on screen while Try again runs, and clears it for a new key', () => {
    const fail = failed(ask(shown(''), 'm', 0), 2, 'Dev Host did not answer.');
    expect(fail.error).toEqual({ key: 'm', reason: 'Dev Host did not answer.', hostProblem: false });

    const again = retry(fail, 9)!;
    expect(again).toMatchObject({ pending: { key: 'm', since: 9 }, error: { key: 'm', reason: 'Dev Host did not answer.', hostProblem: false } });
    expect(answered(again, again.ticket, ['muxify'], false).error).toBeNull();

    expect(ask(fail, 'mu', 9).error).toBeNull();
  });

  it('ignores Try again while a read runs, and before the first ask', () => {
    expect(retry(ask(unasked(), 'm', 0), 1)).toBeNull();
    expect(retry(unasked(), 1)).toBeNull();
  });

  it('drops a late answer after a cancel, and keeps what was on screen', () => {
    const asked = ask(shown('', 'muxify'), 'm', 0);
    const stopped = cancel(asked);
    expect(isPending(stopped)).toBe(false);
    expect(answered(stopped, asked.ticket, ['late'], false)).toBe(stopped);
    expect(stopped.answer).toEqual({ key: '', data: ['muxify'] });
  });

  it('holds an answer until it is released or a new ask comes', () => {
    const asked = ask(shown('', 'kept'), '', 0);
    const holding = answered(asked, asked.ticket, ['fresh', 'kept'], true);
    expect(holding).toMatchObject({ pending: null, answer: { data: ['kept'] }, held: { key: '', data: ['fresh', 'kept'] } });
    expect(release(holding)).toMatchObject({ answer: { data: ['fresh', 'kept'] }, held: null });
    expect(ask(holding, 'm', 0)).toMatchObject({ answer: { data: ['fresh', 'kept'] }, held: null });
  });

  it('shows a kept answer only before the first answer, and only for the key that runs', () => {
    const kept = { key: '', data: ['kept'] };
    expect(seed(ask(unasked(), '', 0), kept).answer).toEqual(kept);
    expect(seed(ask(unasked(), 'm', 0), kept).answer).toBeNull();
    expect(seed(shown('', 'fresh'), kept).answer).toEqual({ key: '', data: ['fresh'] });
  });
});
