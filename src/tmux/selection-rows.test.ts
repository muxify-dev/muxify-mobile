import { selectionRows } from './selection-rows';

describe('selectionRows', () => {
  it('numbers the rows from the top line and drops the colours', () => {
    const rows = selectionRows(['\u001b[31mred\u001b[0m text', '$ ls'], ['red text', '$ ls'], 40, 80);
    expect(rows).toEqual([
      { line: 40, text: 'red text', wraps: false },
      { line: 41, text: '$ ls', wraps: false },
    ]);
  });

  it('marks a row that tmux wrapped, and keeps the spaces at its end', () => {
    // As tmux 3.8 gives them: -N pads the last row, -J does not.
    const rows = selectionRows(['one two ', 'three     ', 'end'], ['one two three', 'end'], 0, 8);
    expect(rows.map((row) => [row.text, row.wraps])).toEqual([
      ['one two ', true],
      ['three', false],
      ['end', false],
    ]);
  });

  it('does not join a row that only fills the width', () => {
    const rows = selectionRows(['12345678', 'next'], ['12345678', 'next'], 0, 8);
    expect(rows.map((row) => row.wraps)).toEqual([false, false]);
  });

  it('keeps a wrap that goes on below the last row captured', () => {
    const rows = selectionRows(['abcd', 'efgh'], ['abcdefghij'], 0, 4);
    expect(rows.map((row) => row.wraps)).toEqual([true, true]);
  });

  it('joins nothing when the two captures do not have the same line ends', () => {
    const rows = selectionRows(['abcd', 'efgh', 'tail'], ['abcdefgh'], 0, 4);
    expect(rows.map((row) => row.wraps)).toEqual([false, false, false]);
  });

  it('maps each UTF-16 unit to its cell where a character is not one cell', () => {
    const [wide] = selectionRows(['a日b'], ['a日b'], 0, 80);
    expect(wide).toEqual({ line: 0, text: 'a日b', cells: [0, 1, 3, 4], wraps: false });

    const [emoji] = selectionRows(['😀!'], ['😀!'], 0, 80);
    expect(emoji.cells).toEqual([0, 0, 2, 3]);

    const [tab] = selectionRows(['ab\tc'], ['ab\tc'], 0, 80);
    expect(tab.cells).toEqual([0, 1, 2, 8, 9]);

    const [combined] = selectionRows(['éx'], ['éx'], 0, 80);
    expect(combined.cells).toEqual([0, 1, 1, 2]);
  });

  it('cuts a row at the width of the Surface, and does not join what is cut', () => {
    const rows = selectionRows(['abcdefgh', 'ij'], ['abcdefghij'], 0, 6);
    expect(rows[0]).toEqual({ line: 0, text: 'abcdef', wraps: false });
  });

  it('cuts before a wide character that does not fit', () => {
    const [row] = selectionRows(['abc日'], ['abc日'], 0, 4);
    expect(row.text).toBe('abc');
  });
});
