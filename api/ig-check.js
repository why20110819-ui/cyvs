// POST /api/ig-check —— 後台管理員用：檢查 Instagram 連線狀態（不會發布任何東西）
const { getAdmins, verify } = require('./_lib/store');

const API_VERSION = 'v23.0';
const clean = v => String(v || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const admins = await getAdmins();
    const u = req.headers['x-admin-user'] ? decodeURIComponent(req.headers['x-admin-user']) : '';
    const p = req.headers['x-admin-pass'] ? decodeURIComponent(req.headers['x-admin-pass']) : '';
    if (!verify(admins, u, p)) return res.status(401).json({ ok: false, error: '未授權' });

    const token = clean(process.env.IG_ACCESS_TOKEN);
    const userId = clean(process.env.IG_USER_ID);
    const lines = [];
    if (!token) lines.push('❌ 未設定 IG_ACCESS_TOKEN');
    if (!userId) lines.push('❌ 未設定 IG_USER_ID');
    if (!token || !userId) return res.status(200).json({ ok: false, report: lines.join('\n') });

    const kind = token.startsWith('IG') ? 'Instagram 登入 Token (IGAA…)' : 'Facebook 登入 Token (EAA…)';
    const base = token.startsWith('IG') ? `https://graph.instagram.com/${API_VERSION}` : `https://graph.facebook.com/${API_VERSION}`;
    lines.push(`Token 類型：${kind}，長度 ${token.length}`);
    lines.push(`IG_USER_ID：${userId}`);

    const get = async (path, params) => {
      const qs = new URLSearchParams({ ...params, access_token: token });
      const r = await fetch(`${base}${path}?${qs}`);
      return r.json().catch(() => ({}));
    };
    const show = e => `code ${e.code ?? '?'}${e.error_subcode ? '/' + e.error_subcode : ''}：${e.message}${e.fbtrace_id ? ' (trace ' + e.fbtrace_id + ')' : ''}`;

    // 1. 讀取帳號資料（只需要讀取權限）
    const acc = await get(`/${userId}`, { fields: 'username,account_type,media_count' });
    if (acc.error) lines.push('❌ 讀取帳號資料失敗 → ' + show(acc.error));
    else lines.push(`✅ 讀取帳號資料成功：@${acc.username || '?'}（${acc.account_type || '類型未知'}，已發 ${acc.media_count ?? '?'} 則）`);

    // 2. 24 小時發文額度
    const lim = await get(`/${userId}/content_publishing_limit`, { fields: 'quota_usage,config' });
    if (lim.error) lines.push('❌ 讀取發文額度失敗 → ' + show(lim.error));
    else {
      const d = (lim.data && lim.data[0]) || {};
      lines.push(`✅ 24 小時發文額度：已用 ${d.quota_usage ?? '?'} / ${(d.config && d.config.quota_total) ?? '?'}`);
    }

    const bad1 = !!acc.error, bad2 = !!lim.error;
    let hint;
    if (bad1 && bad2) hint = '→ 連「讀取」都被擋：問題在 Token / App 本身（Token 失效、App 被限制或停用、授權被撤銷）。請重新產生 Token，並檢查 Meta 開發者後台的 App 警示。';
    else if (!bad1 && bad2) hint = '→ 帳號可讀取，但發文相關 API 被擋：多半是缺少 instagram_content_publish 權限，或發文功能被 Meta 暫時限制。';
    else if (!bad1 && !bad2) hint = '→ Token 與帳號正常。若發布仍顯示 blocked，代表只有「建立貼文」被限制（短期限流或內容被判定可疑），請等待一段時間，不要連續重試。';
    else hint = '→ 帳號資料讀取失敗但額度可讀，請把以上內容貼給開發者判斷。';
    lines.push('', hint);

    return res.status(200).json({ ok: !bad1 && !bad2, report: lines.join('\n') });
  } catch (err) {
    console.error('ig-check error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
