// /api/data  —— 後台專用讀寫
//   POST ?action=login                      登入（回傳管理員清單）
//   GET  ?file=ab|ak|aa|ap                  讀取（需登入）
//   GET  ?public=aa                         公開讀取公告（學生端用，即時、不需等部署）
//   POST ?file=aa|ap     { data }           整份寫入
//   POST ?action=deletePost { secret_id }   刪除單筆投稿（伺服器端重新編號並更新 ak）
//   POST ?action=deleteAllPosts             清空投稿（保留計數器）
//   POST ?action=syncLogs                   補齊 ak、清除超過一年的紀錄
// 所有寫入都會在 GitHub 上讀回驗證，失敗會回傳錯誤。
const { update, readLatest, getAdmins, verify, pad, numOf, MASTER_ADMIN, DEFAULTS } = require('./_lib/store');

const DELETED = '貼文已刪除 (IP留存中)';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function fail(status, message) { const e = new Error(message); e.status = status; return e; }

function isMaster(a) { return a && (a.username === MASTER_ADMIN || a.isSuper); }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const q = req.query || {};

    // 公開公告（學生端）
    if (req.method === 'GET' && q.public === 'aa') {
      const aa = await readLatest('aa');
      return res.status(200).json({ content: aa.content || '' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const admins = await getAdmins();

    if (req.method === 'POST' && q.action === 'login') {
      const admin = verify(admins, String(body.username || ''), String(body.password || ''));
      if (!admin) return res.status(401).json({ error: '帳號或密碼錯誤' });
      return res.status(200).json({ ok: true, admins });
    }

    // ===== 以下皆需驗證 =====
    const u = req.headers['x-admin-user'] ? decodeURIComponent(req.headers['x-admin-user']) : '';
    const p = req.headers['x-admin-pass'] ? decodeURIComponent(req.headers['x-admin-pass']) : '';
    const me = verify(admins, u, p);
    if (!me) return res.status(401).json({ error: '未授權' });

    if (req.method === 'GET') {
      const key = String(q.file || '');
      if (!['aa', 'ab', 'ak', 'ap'].includes(key)) return res.status(400).json({ error: '不支援的檔案' });
      return res.status(200).json(await readLatest(key));
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // ----- 刪除單筆 -----
    if (q.action === 'deletePost') {
      const sid = String(body.secret_id || '');
      const out = await update(async ({ read }) => {
        const ab = await read('ab');
        const ak = await read('ak');
        const target = ab.find(x => x.secret_id === sid);
        if (!target) throw fail(404, '找不到該筆投稿（可能已被刪除，請重新整理）');

        const log = ak.find(l => l.secret_id === sid);
        if (log) log.status = DELETED;
        else ak.push({ ...target, status: DELETED });

        const posts = ab.filter(x => x.secret_id !== sid).map((x, i) => ({ ...x, id: '#CY' + pad(i + 1) }));
        return { changes: { ab: posts, ak }, result: { posts, ipLogs: ak } };
      }, `admin(${me.username}): delete post`);
      return res.status(200).json({ ok: true, ...out });
    }

    // ----- 清空全部 -----
    if (q.action === 'deleteAllPosts') {
      const out = await update(async ({ read }) => {
        const ab = await read('ab');
        const ak = await read('ak');
        const am = await read('am');

        const counter = Math.max(Number(am.counter) || 0, ...ab.map(x => numOf(x.id)), 0);
        for (const post of ab) {
          const log = ak.find(l => l.secret_id === post.secret_id);
          if (log) log.status = DELETED;
          else ak.push({ ...post, status: DELETED });
        }
        return {
          changes: { ab: [], ak, am: { counter } },
          result: { posts: [], ipLogs: ak, nextNumber: '#CY' + pad(counter + 1) }
        };
      }, `admin(${me.username}): delete all posts`);
      return res.status(200).json({ ok: true, ...out });
    }

    // ----- 補齊 / 清理 ak -----
    if (q.action === 'syncLogs') {
      const out = await update(async ({ read }) => {
        const ab = await read('ab');
        let ak = await read('ak');
        for (const post of ab) {
          if (!ak.some(l => l.secret_id === post.secret_id)) ak.push({ ...post, status: '貼文發布中' });
        }
        const now = Date.now();
        ak = ak.filter(l => now - new Date(l.timestamp).getTime() < ONE_YEAR_MS);
        return { changes: { ak }, result: { ipLogs: ak } };
      }, `admin(${me.username}): sync logs`);
      return res.status(200).json({ ok: true, ...out });
    }

    // ----- 整份寫入 aa / ap -----
    const key = String(q.file || '');
    if (key === 'aa' || key === 'ap') {
      const data = body.data;
      if (data === undefined) throw fail(400, '缺少 data');

      if (key === 'aa') {
        if (typeof data !== 'object' || data === null || typeof data.content !== 'string') throw fail(400, '公告格式錯誤');
      }

      if (key === 'ap') {
        if (!Array.isArray(data) || !data.length) throw fail(400, '管理員清單不可為空');
        if (!data.every(a => a && typeof a.username === 'string' && typeof a.password === 'string')) throw fail(400, '管理員資料格式錯誤');
        if (!data.some(a => a.username === MASTER_ADMIN)) throw fail(400, '主帳號不可移除');
        // 非主帳號只能修改自己的密碼
        if (!isMaster(me)) {
          const current = await readLatest('ap');
          const others = x => JSON.stringify(x.filter(a => a.username !== me.username));
          if (others(current) !== others(data)) throw fail(403, '只有主帳號可以新增、刪除或修改其他管理員');
        }
      }

      await update(async () => ({ changes: { [key]: data } }), `admin(${me.username}): update ${key}.json`);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: '未知的操作' });
  } catch (err) {
    console.error('data error:', err);
    return res.status(err.status || 500).json({ error: err.message || String(err) });
  }
};