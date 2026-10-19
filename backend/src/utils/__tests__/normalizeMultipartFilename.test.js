'use strict';

const { normalizeMultipartFilename } = require('../normalizeMultipartFilename');

describe('normalizeMultipartFilename', () => {
  it('recovers UTF-8 Chinese names exposed as Latin-1 mojibake', () => {
    const expected = '验收中文文件名.jpg';
    const latin1View = Buffer.from(expected, 'utf8').toString('latin1');
    expect(normalizeMultipartFilename(latin1View)).toBe(expected);
  });

  it('leaves normal ASCII and already-decoded Unicode unchanged', () => {
    expect(normalizeMultipartFilename('DSC04603.jpg')).toBe('DSC04603.jpg');
    expect(normalizeMultipartFilename('照片.jpg')).toBe('照片.jpg');
    expect(normalizeMultipartFilename('portrait-📷.jpg')).toBe('portrait-📷.jpg');
  });

  it('preserves a genuine Latin-1 filename and malformed byte sequences', () => {
    expect(normalizeMultipartFilename('café.jpg')).toBe('café.jpg');
    expect(normalizeMultipartFilename('\u00e9\u00aa.jpg')).toBe('\u00e9\u00aa.jpg');
  });
});
