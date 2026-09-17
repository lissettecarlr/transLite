// The unlock password is never stored. The decrypted key lives in session only.
const LT_VAULT = (() => {
  const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  async function derive(password, salt) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:600000, hash:'SHA-256'}, material, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  }
  async function seal(apiKey, password, endpoint) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 200) throw new Error('请设置至少 12 位的解锁密码');
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await derive(password, salt);
    const data = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:new TextEncoder().encode(endpoint)}, key, new TextEncoder().encode(apiKey));
    return {version:1, salt:encode(salt), iv:encode(iv), data:encode(data), endpoint};
  }
  async function open(record, password) {
    if (!record || record.version !== 1 || typeof password !== 'string' || password.length > 200) throw new Error('没有可解锁的密钥');
    try {
      const key = await derive(password, decode(record.salt));
      const data = await crypto.subtle.decrypt({name:'AES-GCM', iv:decode(record.iv), additionalData:new TextEncoder().encode(record.endpoint)}, key, decode(record.data));
      return new TextDecoder().decode(data);
    } catch { throw new Error('解锁失败，请检查密码'); }
  }
  return {seal, open};
})();
