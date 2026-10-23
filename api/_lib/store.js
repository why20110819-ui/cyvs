// 共用儲存層：透過 GitHub Git Data API，以「單一 commit」原子更新多個 JSON 檔。
// 特點：
//  1. 每次都從「最新 commit」讀取資料再套用變更（不會用過期資料覆蓋別人的更新）
//  2. ref 更新衝突 (有人同時寫入) 會自動重試
//  3. 寫入後會從分支重新讀回並比對，內容不一致就丟錯誤（不會「畫面改了但 JSON 沒變」）

const FILES = { aa: 'aa.json', ab: 'ab.json', ak: 'ak.json', ap: 'ap.json', am: 'am.json' };

const DEFAULTS = {
  aa: { content: '歡迎來到匿名啟英 CY 投稿平台，請遵守投稿規範！', text: '歡迎來到匿名啟英 CY 投稿平台，請遵守投稿規範！' },
  ab: [],
  ak: [],
  ap: [{ username: 'cvysF133', password: 'admincyvsF133', isSuper: true, isDefault: true }],
  am: { counter: 0 }
};

const MASTER_ADMIN = 'cvysF133';

function cfg() {
  const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH = 'main', DATA_DIR = 'data' } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    const e = new Error('尚未設定環境變數 GITHUB_TOKEN / GITHUB_REPO');
    e.status = 500;
    throw e;
  }
  return { token: GITHUB_TOKEN, repo: GITHUB_REPO, branch: GITHUB_BRANCH, dir: DATA_DIR.replace(/^\/+|\/+$/g, '') };
}

function pathOf(key) {
  const { dir } = cfg();
  return dir ? `${dir}/${FILES[key]}` : FILES[key];
}

async function gh(url, { method = 'GET', body, raw = false } = {}) {
  const { token } = cfg();
  const r = await fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cy-admin',
      'Cache-Control': 'no-cache',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  return r;
}

// 讀取某個 ref（分支名或 commit sha）上的檔案；不存在回傳預設值
async function readAt(key, ref) {
  const { repo } = cfg();
  const r = await gh(`/repos/${repo}/contents/${pathOf(key)}?ref=${encodeURIComponent(ref)}&_=${Date.now()}`, { raw: true });
  if (r.status === 404) return JSON.parse(JSON.stringify(DEFAULTS[key]));
  if (!r.ok) throw new Error(`GitHub 讀取 ${FILES[key]} 失敗 (${r.status}): ${await r.text()}`);
  const text = await r.text();
  return text.trim() ? JSON.parse(text) : JSON.parse(JSON.stringify(DEFAULTS[key]));
}

// 讀最新資料（不寫入）
async function readLatest(key) {
  const { branch } = cfg();
  return readAt(key, branch);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * updater({ read }) → { changes: { key: newData, ... }, result }
 *   - read(key) 讀取「同一個 commit 快照」上的資料
 *   - changes 為空物件或 null → 不 commit
 * 回傳 updater 的 result
 */
async function update(updater, message = 'admin: update data') {
  const { repo, branch } = cfg();
  let lastErr;

  for (let attempt = 0; attempt < 5; attempt++) {
    // 1. 最新 commit
    const refRes = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    if (!refRes.ok) throw new Error(`找不到分支 ${branch} (${refRes.status}): ${await refRes.text()}`);
    const headSha = (await refRes.json()).object.sha;
    const commitRes = await gh(`/repos/${repo}/git/commits/${headSha}`);
    if (!commitRes.ok) throw new Error(`讀取 commit 失敗 (${commitRes.status})`);
    const baseTree = (await commitRes.json()).tree.sha;

    // 2. 以該 commit 快照執行變更
    const cache = {};
    const read = async key => {
      if (!(key in cache)) cache[key] = await readAt(key, headSha);
      return JSON.parse(JSON.stringify(cache[key]));
    };
    const out = await updater({ read });
    const changes = (out && out.changes) || {};

    // 只提交真的有變的檔案
    const entries = [];
    for (const key of Object.keys(changes)) {
      const before = await read(key);
      if (!same(before, changes[key])) {
        entries.push({
          path: pathOf(key),
          mode: '100644',
          type: 'blob',
          content: JSON.stringify(changes[key], null, 2) + '\n'
        });
      }
    }
    if (!entries.length) return out ? out.result : undefined;

    // 3. 建立 tree / commit，更新分支（非 force：若有人搶先寫入會失敗並重試）
    const treeRes = await gh(`/repos/${repo}/git/trees`, { method: 'POST', body: { base_tree: baseTree, tree: entries } });
    if (!treeRes.ok) throw new Error(`建立 tree 失敗 (${treeRes.status}): ${await treeRes.text()}`);
    const treeSha = (await treeRes.json()).sha;

    const newCommitRes = await gh(`/repos/${repo}/git/commits`, {
      method: 'POST',
      body: { message, tree: treeSha, parents: [headSha] }
    });
    if (!newCommitRes.ok) throw new Error(`建立 commit 失敗 (${newCommitRes.status}): ${await newCommitRes.text()}`);
    const newSha = (await newCommitRes.json()).sha;

    const patchRes = await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      body: { sha: newSha, force: false }
    });
    if (patchRes.status === 422 || patchRes.status === 409) {
      lastErr = new Error('同時有其他寫入，重試中');
      await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
      continue;
    }
    if (!patchRes.ok) throw new Error(`更新分支失敗 (${patchRes.status}): ${await patchRes.text()}`);

    // 4. 讀回驗證：確認分支上的 JSON 真的等於我們要寫的內容
    for (const key of Object.keys(changes)) {
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        if (i) await new Promise(r => setTimeout(r, 400));
        ok = same(await readAt(key, branch), changes[key]);
      }
      if (!ok) throw new Error(`寫入驗證失敗：${FILES[key]} 在 GitHub 上的內容與預期不一致`);
    }
    return out.result;
  }
  throw lastErr || new Error('寫入失敗');
}

// ===== 管理員驗證 =====
async function getAdmins() {
  const ap = await readLatest('ap');
  return Array.isArray(ap) && ap.length ? ap : DEFAULTS.ap;
}
function verify(admins, u, p) {
  return admins.find(a => a.username === u && a.password === p) || null;
}

function pad(n) { return String(n).padStart(3, '0'); }
function numOf(id) { const m = String(id || '').match(/\d+/); return m ? parseInt(m[0], 10) : 0; }

module.exports = { FILES, DEFAULTS, MASTER_ADMIN, readLatest, update, getAdmins, verify, pad, numOf };