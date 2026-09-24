import { directoryName } from './paths';

describe('directoryName', () => {
  it('takes the last segment, which is what distinguishes two Panes', () => {
    expect(directoryName('/home/ubuntu/projects/muxify')).toBe('muxify');
  });

  it('ignores a trailing slash rather than reading it as an empty name', () => {
    expect(directoryName('/home/ubuntu/')).toBe('ubuntu');
  });

  it('names the root, which has no last segment of its own', () => {
    expect(directoryName('/')).toBe('/');
  });

  it('leaves a bare name alone', () => {
    expect(directoryName('muxify')).toBe('muxify');
  });

  it('has nothing to say about a Pane that reported no path', () => {
    expect(directoryName('')).toBe('');
  });
});
