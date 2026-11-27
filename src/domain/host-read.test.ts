import { answered, ask, cancel, failed, forget, isPending, retry, unasked, type HostRead } from './host-read';

type Read = HostRead<string, string[]>;

const shown = (key: string, ...data: string[]): Read => answered(ask(unasked(), key, 0), 1, data);

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
    expect(answered(second, first.ticket, ['old'])).toBe(second);
    expect(failed(second, first.ticket, 'gone')).toBe(second);
    expect(answered(second, second.ticket, ['muxify'])).toMatchObject({ pending: null, answer: { key: 'mu', data: ['muxify'] } });
  });

  it('keeps the failure on screen while Try again runs, and clears it for a new key', () => {
    const fail = failed(ask(shown(''), 'm', 0), 2, 'Dev Host did not answer.');
    expect(fail.error).toEqual({ key: 'm', reason: 'Dev Host did not answer.', hostProblem: false });

    const again = retry(fail, 9)!;
    expect(again).toMatchObject({ pending: { key: 'm', since: 9 }, error: { key: 'm', reason: 'Dev Host did not answer.', hostProblem: false } });
    expect(answered(again, again.ticket, ['muxify']).error).toBeNull();

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
    expect(answered(stopped, asked.ticket, ['late'])).toBe(stopped);
    expect(stopped.answer).toEqual({ key: '', data: ['muxify'] });
  });

  it('forgets its answer, so the next ask starts with no rows, and drops a late answer', () => {
    const asked = ask(shown('', 'muxify'), 'm', 0);
    const forgotten = forget(asked);
    expect(forgotten).toMatchObject({ pending: null, answer: null, error: null, asked: null });
    expect(answered(forgotten, asked.ticket, ['late'])).toBe(forgotten);
    expect(ask(forgotten, '', 0).answer).toBeNull();
  });
});
