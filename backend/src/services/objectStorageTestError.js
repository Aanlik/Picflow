const MAX_USER_ERROR_LENGTH = 260;

const SAFE_PROVIDER_ERRORS = {
  S3_PRIVATE_ENDPOINT: '对象存储地址位于内网，请由超级管理员确认该 Endpoint。',
  S3_ENDPOINT_FORBIDDEN: '对象存储 Endpoint 指向禁止访问的地址。',
  S3_ENDPOINT_UNRESOLVED: '无法解析对象存储 Endpoint 主机名。',
  S3_ENDPOINT_INVALID: '对象存储 Endpoint 格式无效。',
  S3_APPROVAL_MISMATCH: '对象存储 Endpoint 与已批准的地址不一致，请重新确认。',
};

function conciseObjectStorageTestError(error) {
  const code = String(error?.code || error?.cause?.code || '');
  const details = `${code} ${String(error?.message || '')}`;
  if (/ERR_TLS_CERT_ALTNAME_INVALID|ALTNAME_INVALID|hostname\/ip does not match|certificate.{0,80}(SAN|subject alternative name)/i.test(details)) {
    return {
      code: 'S3_TLS_CERTIFICATE_MISMATCH',
      error: '对象存储证书域名与 Endpoint 不匹配。请检查 Endpoint 主机名和存储桶地域。',
    };
  }
  if (/CERT_|ERR_TLS|ERR_SSL|SELF_SIGNED/i.test(details)) {
    return {
      code: 'S3_TLS_CERTIFICATE_INVALID',
      error: '对象存储 TLS 证书校验失败。请检查证书有效期、证书链和 Endpoint。',
    };
  }
  // Keep validation messages that the application itself produced, but never
  // return raw provider/Node errors (which can include a huge certificate SAN list).
  if (error?.status && typeof error.message === 'string') {
    return {
      ...(code ? { code } : {}),
      error: error.message.replace(/\s+/g, ' ').slice(0, MAX_USER_ERROR_LENGTH),
    };
  }
  if (SAFE_PROVIDER_ERRORS[code]) return { code, error: SAFE_PROVIDER_ERRORS[code] };
  return {
    code: 'S3_CONNECTION_FAILED',
    error: '对象存储连接失败。请检查 Endpoint、Region、Bucket、访问密钥和网络。',
  };
}

module.exports = { conciseObjectStorageTestError, MAX_USER_ERROR_LENGTH };
