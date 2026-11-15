import { check, ended, hostWriteLine, IDLE, reached, send, type HostWrite } from './host-write';

const words = { host: 'Dev Host', sending: 'Creating Fix login', attaching: 'Opening fix-login', mayHaveHappened: 'The Topic may exist.' };

function running(step: 'connecting' | 'sending' | 'checking' | 'attaching'): HostWrite {
  return reached(send(IDLE, 0)!, step);
}

describe('a Host Write', () => {
  it('runs one at a time', () => {
    expect(send(running('sending'), 1)).toBeNull();
    expect(send({ kind: 'failed', reason: 'refused' }, 1)).toEqual({ kind: 'running', step: 'connecting', since: 1 });
  });

  it('is not sent again while it is unsure, and only an unsure one is checked', () => {
    const unsure: HostWrite = { kind: 'unsure', reason: 'Dev Host did not answer in time.' };
    expect(send(unsure, 1)).toBeNull();
    expect(check(unsure, 1)).toEqual({ kind: 'running', step: 'checking', since: 1 });
    expect(check(IDLE, 1)).toBeNull();
  });

  it('fails when it breaks before a command left the phone, or while the Attach opens', () => {
    expect(ended(running('connecting'), { kind: 'threw', reason: 'refused' })).toEqual({ kind: 'failed', reason: 'refused' });
    expect(ended(running('attaching'), { kind: 'threw', reason: 'gone' })).toEqual({ kind: 'failed', reason: 'gone' });
  });

  it('is unsure when it breaks while a command is out, or while it is checked', () => {
    expect(ended(running('sending'), { kind: 'threw', reason: 'late' })).toEqual({ kind: 'unsure', reason: 'late' });
    expect(ended(running('checking'), { kind: 'threw', reason: 'late' })).toEqual({ kind: 'unsure', reason: 'late' });
  });

  it('is unsure, at any step, when the command went out and the Host gave no answer it can trust', () => {
    expect(ended(running('connecting'), { kind: 'unknown', reason: 'in doubt' })).toEqual({ kind: 'unsure', reason: 'in doubt' });
    expect(ended(running('sending'), { kind: 'unknown', reason: 'late' })).toEqual({ kind: 'unsure', reason: 'late' });
  });

  it("keeps the Host's reasons for each field", () => {
    expect(ended(running('sending'), { kind: 'refused', reason: 'no', fields: { title: 'taken' } }))
      .toEqual({ kind: 'failed', reason: 'no', fields: { title: 'taken' } });
    expect(ended(running('sending'), { kind: 'done' })).toBe(IDLE);
  });
});

describe('the line that reports a Host Write', () => {
  it('says what runs, and the seconds after five', () => {
    expect(hostWriteLine(reached(send(IDLE, 0)!, 'sending'), words, 4_999)).toBe('Creating Fix login on Dev Host…');
    expect(hostWriteLine(reached(send(IDLE, 0)!, 'sending'), words, 7_200)).toBe('Creating Fix login on Dev Host… 7 s');
    expect(hostWriteLine(send(IDLE, 0)!, { ...words, host: null }, 0)).toBe('Connecting to the Host…');
  });

  it('gives a field reason only under its field', () => {
    expect(hostWriteLine({ kind: 'failed', reason: 'no', fields: { title: 'taken' } }, words, 0)).toBeNull();
    expect(hostWriteLine({ kind: 'failed', reason: 'Connection refused' }, words, 0)).toBe('Connection refused');
  });

  it('says what may have happened when unsure', () => {
    expect(hostWriteLine({ kind: 'unsure', reason: 'Dev Host did not answer in time.' }, words, 0))
      .toBe('Dev Host did not answer in time. The Topic may exist.');
  });
});
