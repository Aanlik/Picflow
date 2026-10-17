const { imageProcessingError } = require('../../src/utils/imageProcessingError');

describe('imageProcessingError', () => {
  it('explains unsupported and corrupt formats in Chinese', () => {
    expect(imageProcessingError('Input file contains unsupported image format'))
      .toBe('不支持该图片格式或文件内容已损坏');
    expect(imageProcessingError('corrupt JPEG data: premature end of data'))
      .toBe('图片文件已损坏，无法解码');
  });

  it('maps file access failures and never exposes decoder internals', () => {
    expect(imageProcessingError({ code: 'EACCES', message: 'permission denied' }))
      .toBe('没有权限读取源文件');
    expect(imageProcessingError('Unexpected decoder assertion 0x1234'))
      .toBe('图片处理失败，请检查源文件是否存在、格式是否受支持且可读取');
  });
});
