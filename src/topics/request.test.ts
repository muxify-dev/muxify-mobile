import {
  intentAfter,
  intentFor,
  newRequestId,
  type Intent,
  type RequestId,
} from './request';

describe('a Request id', () => {
  it('has the UUID layout that the Host CLI accepts', () => {
    expect(newRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is new each time', () => {
    expect(new Set(Array.from({ length: 200 }, newRequestId)).size).toBe(200);
  });
});

describe('the Intent of a form', () => {
  const ids = ['id-1', 'id-2', 'id-3'] as RequestId[];
  const maker = () => {
    let next = 0;
    return () => ids[next++]!;
  };
  const key = (title: string, tags: string[]) => JSON.stringify([title, tags]);

  it('keeps its Request id for a Try again with the same title and Tags', () => {
    const make = maker();
    const first = intentFor(null, key('Fix login', ['work']), make);
    const held = intentAfter(first, { kind: 'unknown' });

    expect(intentFor(held, key('Fix login', ['work']), make).request).toBe('id-1');
  });

  it('gets a new Request id when the title or the Tags change', () => {
    const make = maker();
    const first: Intent = intentFor(null, key('Fix login', ['work']), make);

    expect(intentFor(first, key('Fix logout', ['work']), make).request).toBe('id-2');
    expect(intentFor(first, key('Fix login', []), make).request).toBe('id-3');
  });

  it('gets a new Request id after a refusal, so the Host does not answer with the old refusal', () => {
    const make = maker();
    const first = intentFor(null, key('Fix login', ['wrok']), make);
    const held = intentAfter(first, { kind: 'failed' });

    expect(intentFor(held, key('Fix login', ['wrok']), make).request).toBe('id-2');
  });
});
