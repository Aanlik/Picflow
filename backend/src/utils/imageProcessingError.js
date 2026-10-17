'use strict';

/** Convert decoder/filesystem failures into concise, actionable UI text. */
function imageProcessingError(reason) {
  const message = String(reason?.message || reason || '').toLowerCase();
  if (/enoent|no such file|not found|does not exist/.test(message)) {
    return '源文件不存在或当前不可访问';
  }
  if (/eacces|eperm|permission denied|read-only file system/.test(message)) {
    return '没有权限读取源文件';
  }
  if (/unsupported image format|unsupported format|input file contains unsupported/.test(message)) {
    return '不支持该图片格式或文件内容已损坏';
  }
  if (/corrupt|invalid image|unexpected end|premature end/.test(message)) {
    return '图片文件已损坏，无法解码';
  }
  return '图片处理失败，请检查源文件是否存在、格式是否受支持且可读取';
}

module.exports = { imageProcessingError };
