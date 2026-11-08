import inPlay from './__fixtures__/environment-in-play.json';
import { parseEnvironment } from './environment';
import { tagsFromParam, tagsParam } from './tags-param';

describe('the Tags route param', () => {
  it('gives back the Tags of the snapshot, in Config order and with their colours', () => {
    const tags = parseEnvironment(inPlay).tags;

    expect(tagsFromParam(tagsParam(tags))).toEqual(tags);
  });

  it('keeps a colour the phone cannot read as no colour', () => {
    const tags = [
      {
        name: 'odd',
        color: { light: null, dark: { kind: 'rgb' as const, hex: '#112233' } },
      },
    ];

    expect(tagsFromParam(tagsParam(tags))).toEqual(tags);
  });

  it.each([undefined, 'not json', '{"tags":1}', '[{"name":3}]'])(
    'gives no Tags for %p',
    (param) => {
      expect(tagsFromParam(param)).toEqual([]);
    },
  );
});
