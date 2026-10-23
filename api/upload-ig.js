// POST /api/upload-ig  { imageUrl, caption }  —— 發布圖片到 Instagram（僅限已登入的後台管理員）
const { getAdmins, verify } = require('./_lib/store');

// 支援兩種 Token：
//   EAA... → Facebook 登入 / Page Token → graph.facebook.com
//   IGAA...→ Instagram 登入 Token       → graph.instagram.com
const API_VERSION = 'v23.0';

function clean(v) {
  // 去掉前後空白、換行、不小心貼進去的引號
  return String(v || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
}

function friendlyError(err, token) {
  const msg = (err && err.message) || 'Unknown error';
  const code = err && err.code;
  if (code === 190 || /access token/i.test(msg)) {
    return `Instagram Token 無效或已過期：${msg}。請重新產生 Token，更新 Vercel 的 IG_ACCESS_TOKEN（前後不可有空白或引號），並重新部署。`;
  }
  if (code === 10 || code === 200) return `權限不足：${msg}。請確認 Token 具有 instagram_content_publish 權限。`;
  if (code === 9004 || code === 9007 || /media/i.test(msg) && /uri|url|fetch/i.test(msg)) {
    return `Instagram 無法讀取圖片：${msg}。imageUrl 必須是公開、可直接開啟的 https 圖片網址（JPEG 最穩定）。`;
  }
  return msg;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    // 1. 驗證後台管理員（避免任何人都能呼叫這個 API 對你的 IG 發文）
    const admins = await getAdmins();
    const u = req.headers['x-admin-user'] ? decodeURIComponent(req.headers['x-admin-user']) : '';
    const p = req.headers['x-admin-pass'] ? decodeURIComponent(req.headers['x-admin-pass']) : '';
    if (!verify(admins, u, p)) return res.status(401).json({ success: false, error: '未授權，請重新登入後台' });

    // 2. 檢查環境變數
    const token = clean(process.env.IG_ACCESS_TOKEN);
    const userId = clean(process.env.IG_USER_ID);
    if (!token || !userId) {
      return res.status(500).json({
        success: false,
        error: `Vercel 尚未設定 ${!token ? 'IG_ACCESS_TOKEN' : ''}${!token && !userId ? ' 與 ' : ''}${!userId ? 'IG_USER_ID' : ''}（設定後需重新部署才會生效）`
      });
    }
    if (/\s/.test(token) || token.length < 40) {
      return res.status(500).json({ success: false, error: 'IG_ACCESS_TOKEN 格式看起來不對（太短或含空白），請重新複製完整 Token' });
    }

    // 3. 檢查輸入
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const imageUrl = String(body.imageUrl || '');
    const caption = String(body.caption || '').slice(0, 2200);
    if (!/^https:\/\//i.test(imageUrl)) {
      return res.status(400).json({ success: false, error: 'imageUrl 必須是公開的 https 網址' });
    }

    const base = token.startsWith('IG') ? `https://graph.instagram.com/${API_VERSION}` : `https://graph.facebook.com/${API_VERSION}`;

    const call = async (path, { method = 'POST', params = {} } = {}) => {
      const qs = new URLSearchParams({ ...params, access_token: token });
      const r = method === 'GET'
        ? await fetch(`${base}${path}?${qs}`)
        : await fetch(`${base}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: qs
          });
      return r.json().catch(() => ({}));
    };

    // 4. 建立 Container
    const container = await call(`/${userId}/media`, { params: { image_url: imageUrl, caption } });
    if (!container.id) {
      const e = container.error || {};
      return res.status(500).json({ success: false, error: friendlyError(e, token), detail: { code: e.code, subcode: e.error_subcode } });
    }

    // 5. 等 Container 處理完成（最多約 10 秒）
    let status = '';
    for (let i = 0; i < 10; i++) {
      const s = await call(`/${container.id}`, { method: 'GET', params: { fields: 'status_code' } });
      status = s.status_code || '';
      if (status === 'FINISHED') break;
      if (status === 'ERROR' || status === 'EXPIRED') {
        return res.status(500).json({ success: false, error: `Instagram 處理圖片失敗 (${status})，請確認圖片網址可公開存取` });
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    // 6. 發布
    const published = await call(`/${userId}/media_publish`, { params: { creation_id: container.id } });
    if (!published.id) {
      const e = published.error || {};
      return res.status(500).json({ success: false, error: friendlyError(e, token), detail: { code: e.code, subcode: e.error_subcode } });
    }

    return res.status(200).json({ success: true, postId: published.id });
  } catch (err) {
    console.error('upload-ig error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};