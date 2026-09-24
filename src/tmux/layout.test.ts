import { parseWindowLayout } from './layout';

// Taken verbatim from tmux 3.6 on a Host: an 80x24 Window split left/right,
// with the left half split top/bottom. Pane ids are %39, %41 and %40.
const NESTED = '67ca,80x24,0,0{40x24,0,0[40x12,0,0,39,40x11,0,13,41],39x24,41,0,40}';

describe('parseWindowLayout', () => {
  it('reads a Window that has never been split', () => {
    expect(parseWindowLayout('bb62,80x24,0,0,3')).toEqual(
      new Map([[3, { left: 0, top: 0, width: 80, height: 24 }]]),
    );
  });

  it('reads nested splits, whose coordinates are already absolute', () => {
    expect(parseWindowLayout(NESTED)).toEqual(
      new Map([
        [39, { left: 0, top: 0, width: 40, height: 12 }],
        [41, { left: 0, top: 13, width: 40, height: 11 }],
        [40, { left: 41, top: 0, width: 39, height: 24 }],
      ]),
    );
  });

  it('keys Panes by id, because that is what the layout names them by', () => {
    expect([...parseWindowLayout(NESTED).keys()]).toEqual([39, 41, 40]);
  });

  it.each([
    ['nothing at all', ''],
    ['a checksum on its own', '67ca'],
    ['a cell with no Pane id', '67ca,80x24,0,0'],
    ['an unbalanced bracket', '67ca,80x24,0,0{40x24,0,0,1'],
    ['trailing rubbish', '67ca,80x24,0,0,1}'],
  ])('reads %s as no layout rather than half of one', (_what, layout) => {
    expect(parseWindowLayout(layout)).toEqual(new Map());
  });
});
