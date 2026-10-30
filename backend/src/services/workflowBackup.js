'use strict';
const { randomUUID } = require('crypto');
const { bridgeConfig, bridgeRequest } = require('./photographyWorkflowBridge');

function checkpointError(result, phase = 'prepare') {
  // Only known protocol messages are safe to show. Never echo an arbitrary
  // Bridge body: it can contain paths or data from a failed operation.
  const reasons = {
    '正在同步照片，请稍后重试备份或恢复': ['BUSY', '正在同步照片，请等待本轮同步完成后重试'],
    '已有备份或恢复任务': ['BUSY', '已有备份或恢复任务，请等待其结束'],
    '项目配置与数据库不一致，不能生成精修状态备份': ['CONFIG_MISMATCH', '项目配置与数据库不一致，请核对项目关联'],
    '精修状态读取超时，请稍后重试': ['EXPORT_TIMEOUT', '精修状态读取超时，请稍后重试'],
    '检查点请求已取消或连接断开': ['CANCELLED', '检查点请求已取消或连接断开'],
  };
  const detail = result.data?.detail;
  const known = typeof detail === 'string' && Object.hasOwn(reasons, detail) ? reasons[detail] : undefined;
  const [code, reason] = known || (result.status === 200
    ? ['INVALID', '检查点返回数据校验失败']
    : ['UNAVAILABLE', `精修同步服务请求失败（HTTP ${Number(result.status) || 503}）`]);
  const error = new Error(`无法备份或恢复精修状态：${reason}，操作已停止`);
  error.code = `BRIDGE_CHECKPOINT_${code}`;
  error.phase = phase;
  error.status = Number(result.status) || 503;
  return error;
}

async function checkpoint(purpose = 'backup') {
  if (!bridgeConfig()) return null;
  const token = randomUUID();
  let checkpoint;
  try {
    const result = await bridgeRequest('/api/state/checkpoint', { method: 'POST', body: { token, purpose } });
    if (result.status !== 200 || result.data?.token !== token || result.data.state?.version !== 1) {
      throw checkpointError(result);
    }
    const activated = await bridgeRequest('/api/state/activate', { method: 'POST', body: { token } });
    if (activated.status !== 200 || !activated.data?.success) throw checkpointError(activated, 'activate');
    checkpoint = result.data;
  } catch (error) {
    // Nothing has been restored/copied yet. The caller owns the ID even if a response was lost.
    const cancelled = await bridgeRequest('/api/state/cancel', { method: 'POST', body: { token } });
    if (![200, 202].includes(cancelled.status)) error.message += '；取消暂停未确认，请在 Bridge 中核对任务状态';
    throw error;
  }
  const timer = setInterval(async () => {
    const renewed = await bridgeRequest('/api/state/renew', { method: 'POST', body: { token: checkpoint.token } });
    if (renewed.status !== 200) checkpoint.renewalError = new Error('精修状态备份锁续期失败，请重新备份');
  }, 60000);
  timer.unref();
  Object.defineProperty(checkpoint, 'timer', { value: timer });
  Object.defineProperty(checkpoint, 'purpose', { value: purpose });
  return checkpoint;
}
async function release(checkpoint) {
  if (!checkpoint) return;
  clearInterval(checkpoint.timer);
  const result = await bridgeRequest('/api/state/release', { method: 'POST', body: { token: checkpoint.token } });
  if (checkpoint.renewalError) throw checkpoint.renewalError;
  if (result.status !== 200) {
    const status = await bridgeRequest('/api/state/status');
    if (status.status === 200 && status.data?.token === null && status.data?.blocked === false) return;
    throw new Error(checkpoint.purpose === 'restore'
      ? '数据恢复已完成，但同步暂停未解除；恢复暂停不会自动到期，请核对 Bridge 状态后手动解除'
      : '无法解除精修状态备份锁，请检查 Bridge；备份暂停最多保持 30 分钟');
  }
}
async function restore(state, checkpoint) {
  if (!checkpoint) throw new Error('恢复精修状态需要可连接的 Bridge');
  const result = await bridgeRequest('/api/state/restore', { method: 'POST', body: { state, token: checkpoint.token } });
  if (result.status !== 200) throw new Error(`精修状态恢复失败（HTTP ${result.status}），请保留备份并检查挂载配置`);
}
async function hold(checkpoint, reason) {
  const result = await bridgeRequest('/api/state/block', { method: 'POST', body: { token: checkpoint.token, reason } });
  if (result.status !== 200) throw new Error('无法持久化恢复暂停，请保持服务停止并人工核对');
  clearInterval(checkpoint.timer);
}
module.exports = { checkpoint, release, restore, hold, isConfigured: () => Boolean(bridgeConfig()) };
