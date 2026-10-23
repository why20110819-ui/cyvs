// POST /api/submit  —— 學生投稿
// 前端只需傳 { content }；編號、識別碼、時間、IP 一律由伺服器產生。
const crypto = require('crypto');
const { update, pad, numOf } = require('./_lib/store');

const MAX_LEN = 300;
const SENSITIVE_WORDS = ['髒話', '去死', '笨蛋', '智障', '垃圾', '幹', '機掰', '靠北', '三小'];
const MIN_INTERVAL_MS = 15 * 1000; // 同一 IP 的最短投稿間隔

const sanitize = s => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'Unknown';
}

function newSecretId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 位 16 進位
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const raw = String(body.content || '').trim();

    if (!raw) return res.status(400).json({ success: false, error: '請輸入投稿內容' });
    if (raw.length > MAX_LEN) return res.status(400).json({ success: false, error: `內容不可超過 ${MAX_LEN} 字` });
    if (SENSITIVE_WORDS.some(w => raw.includes(w))) {
      return res.status(400).json({ success: false, error: '內容包含敏感或不當詞彙，請修改後再試' });
    }

    const ip = clientIp(req);
    const ua = String(req.headers['user-agent'] || 'Unknown').slice(0, 300);
    const ipField = `${ip} (${ua})`;

    const result = await update(async ({ read }) => {
      const ab = await read('ab');
      const ak = await read('ak');
      const am = await read('am');

      // 同 IP 太頻繁
      const now = Date.now();
      const last = ak.filter(l => String(l.ip || '').startsWith(ip + ' ')).map(l => new Date(l.timestamp).getTime());
      if (last.length && now - Math.max(...last) < MIN_INTERVAL_MS) {
        const e = new Error('投稿太頻繁，請稍後再試');
        e.status = 429;
        throw e;
      }

      // 編號：取 (目前最大編號, 清空時保留的計數器) 的較大者 + 1
      const maxAb = ab.reduce((m, p) => Math.max(m, numOf(p.id)), 0);
      const next = Math.max(maxAb, Number(am.counter) || 0) + 1;
      const id = '#CY' + pad(next);

      // 識別碼不可重複
      const used = new Set([...ab, ...ak].map(p => p.secret_id));
      let secret = newSecretId();
      while (used.has(secret)) secret = newSecretId();

      const post = { id, secret_id: secret, content: sanitize(raw), ip: ipField, timestamp: new Date(now).toISOString() };
      ab.push(post); // 依編號遞增排列（後台刪除時依順序重新編號）
      ak.push({ ...post, status: '貼文發布中' });

      return { changes: { ab, ak }, result: { id, secret_id: secret } };
    }, 'submit: new post');

    return res.status(200).json({ success: true, id: result.id, secret_id: result.secret_id });
  } catch (err) {
    console.error('submit error:', err);
    return res.status(err.status || 500).json({ success: false, error: err.status ? err.message : '投稿寫入失敗：' + err.message });
  }
};