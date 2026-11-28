import { createPaneVisit } from './pane-visit';

function reads() {
  const sent: string[][] = [];
  return { sent, read: (panes: string[]) => { sent.push(panes); return true; } };
}

describe('Unread on visit', () => {
  it('reads every shown Pane on focus, then only the Panes that newly show', () => {
    const visit = createPaneVisit();
    const { sent, read } = reads();
    visit.focus();
    visit.observe(['%1', '%2'], true, read);
    visit.observe(['%2'], true, read);
    visit.observe(['%2', '%3'], true, read);
    visit.observe(['%1', '%2', '%3'], true, read);
    expect(sent).toEqual([['%1', '%2'], ['%3'], ['%1']]);
  });

  it('reads every shown Pane again after an entry', () => {
    const visit = createPaneVisit();
    const { sent, read } = reads();
    visit.focus();
    visit.observe(['%1'], true, read);
    visit.enter();
    visit.observe(['%1'], true, read);
    expect(sent).toEqual([['%1'], ['%1']]);
  });

  it('reads nothing out of focus or before the Panes settle, and reads them once they do', () => {
    const visit = createPaneVisit();
    const { sent, read } = reads();
    visit.observe(['%1'], true, read);
    const blur = visit.focus();
    visit.observe(['%1', '%2'], false, read);
    visit.observe(['%1'], true, read);
    blur();
    visit.observe(['%1', '%2'], true, read);
    expect(sent).toEqual([['%1']]);
  });

  it('keeps reading while a second focus has not lost it', () => {
    const visit = createPaneVisit();
    const { sent, read } = reads();
    const first = visit.focus();
    visit.focus();
    first();
    first();
    visit.observe(['%1'], true, read);
    expect(sent).toEqual([['%1']]);
  });

  it('offers the Panes it could not send again at the next look', () => {
    const visit = createPaneVisit();
    const sent: string[][] = [];
    let server = false;
    visit.focus();
    visit.observe(['%1'], true, (panes) => { sent.push(panes); return server; });
    server = true;
    visit.observe(['%1'], true, (panes) => { sent.push(panes); return server; });
    expect(sent).toEqual([['%1'], ['%1']]);
  });
});

describe('Terminal Screen focus', () => {
  it('is in focus from focus until its own blur, and counts overlapping screens', () => {
    const visit = createPaneVisit();
    expect(visit.focused()).toBe(false);
    const first = visit.focus();
    const second = visit.focus();
    expect(visit.focused()).toBe(true);
    first();
    expect(visit.focused()).toBe(true);
    second();
    expect(visit.focused()).toBe(false);
  });
});
