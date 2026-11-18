import { titleSheetNotice } from './title-sheet-notice';

const unreachable = { kind: 'host-unreachable', detail: 'The Host did not answer in time.' } as const;

describe('the Title Sheet notice', () => {
  it('is the Host Problem alone when the Topic read met it too, with one Try again for every read', () => {
    expect(titleSheetNotice({ actionError: undefined, problem: unreachable, hostName: 'mac', topic: { kind: 'failed', error: 'Topics are unavailable on this Host: no Host Server runs on its Connection.', last: null } }))
      .toEqual({ text: 'Could not reach mac. The Host did not answer in time.', retry: 'host' });
  });

  it('answers the last tap first, with nothing to try again', () => {
    expect(titleSheetNotice({ actionError: 'The Session is gone.', problem: unreachable, hostName: 'mac', topic: undefined }))
      .toEqual({ text: 'The Session is gone.', retry: null });
  });

  it('says a Topic the Host refused, and tries that read again', () => {
    expect(titleSheetNotice({ actionError: undefined, problem: null, hostName: 'mac', topic: { kind: 'failed', error: 'no such Topic', last: null } }))
      .toEqual({ text: 'no such Topic', retry: 'topic' });
  });

  it('is nothing when every read answered', () => {
    expect(titleSheetNotice({ actionError: undefined, problem: null, hostName: 'mac', topic: undefined })).toBeNull();
  });
});
