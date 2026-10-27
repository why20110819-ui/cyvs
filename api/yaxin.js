const crypto = require('crypto');
const https = require('https');
const net = require('net');

const SCHOOL_ORIGIN = 'https://sch.cyvs.tyc.edu.tw';
const configuredSchoolIp = String(process.env.YAXIN_ORIGIN_IP || '').trim();
const SCHOOL_IP = net.isIP(configuredSchoolIp) === 4 ? configuredSchoolIp : '210.59.41.220';
const LOGIN_URL = `${SCHOOL_ORIGIN}/SCH_UI/`;
const DEFAULT_TARGET = '/SCH_UI/SSO/SIndex.aspx?AsParam=X0Z3UzJuJWU1JTg2JWE5JWU1JThhJWFiJWU3JThjJTlhJWU2JTg2JWIzZkxUVWtPVyUxN28lN2QlN2MlMGIlN2IlMDUlMDMlN2IlMDElMDIlMTZXV1o5dTIlM2MlMjc4MyUxNSVlNSVhZCU4OSVlNyU5NCVhYw==';
const SESSION_NAME = 'yaxin_session';
const SESSION_SECONDS = 60 * 60 * 2;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function json(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(x => x.trim().split('=')) .filter(x => x.length >= 2));
}

function sessionSecret() {
  const value = process.env.YAXIN_SESSION_SECRET;
  if (!value && process.env.NODE_ENV === 'production') throw new Error('Vercel 未設定 YAXIN_SESSION_SECRET');
  return value || 'local-development-only-change-this-secret';
}

function encryptSession(cookieHeader) {
  const key = crypto.createHash('sha256').update(sessionSecret()).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.from(JSON.stringify({ cookieHeader, exp: Date.now() + SESSION_SECONDS * 1000 }));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(x => x.toString('base64url')).join('.');
}

function decryptSession(value) {
  if (!value) return null;
  try {
    const [ivB64, tagB64, dataB64] = value.split('.');
    const key = crypto.createHash('sha256').update(sessionSecret()).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const raw = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]);
    const session = JSON.parse(raw.toString('utf8'));
    return session.exp > Date.now() ? session : null;
  } catch { return null; }
}

function setSessionCookie(req, token) {
  const local = String(req.headers.host || '').startsWith('localhost');
  const secure = local ? '' : ' Secure;';
  const sameSite = local ? 'Lax' : 'None';
  return `${SESSION_NAME}=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${SESSION_SECONDS};${secure}`;
}

function clearSessionCookie(req) {
  const local = String(req.headers.host || '').startsWith('localhost');
  const secure = local ? '' : ' Secure;';
  const sameSite = local ? 'Lax' : 'None';
  return `${SESSION_NAME}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0;${secure}`;
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const one = headers.get('set-cookie');
  return one ? [one] : [];
}

function cookiePair(setCookie) {
  return String(setCookie).split(';')[0];
}

function mergeCookies(...headers) {
  const jar = new Map();
  headers.flat().filter(Boolean).forEach(header => {
    String(header).split(/,(?=[^;]+=[^;]+)/).forEach(item => {
      const pair = cookiePair(item);
      const index = pair.indexOf('=');
      if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
    });
  });
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function hiddenFields(html) {
  const fields = {};
  for (const name of ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION']) {
    const re = new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i');
    const alt = new RegExp(`value=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i');
    const match = html.match(re) || html.match(alt);
    if (match) fields[name] = match[1];
  }
  return fields;
}

function looksLikeLoginFailure(html) {
  return /帳號|密碼|登入失敗|錯誤|invalid|login failed/i.test(String(html).slice(0, 12000)) && !/登出|Logout|Sign.?out/i.test(String(html));
}

function decodeHtml(value) {
  return String(value || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function moduleLink(html, code) {
  const source = String(html);
  const matches = [...source.matchAll(/(?:href|action|onclick|data-url|data-href|src)=["']([^"']+)["']/gi)];
  const found = matches.find(m => new RegExp(code, 'i').test(m[1]));
  if (found) {
    const url = found[1].match(/(?:https?:\/\/[^'"\s]+|\/[^'"\s]+\.(?:aspx|ashx|asmx)(?:\?[^'"\s]*)?)/i);
    if (url) return decodeHtml(url[0]);
  }
  const index = source.search(new RegExp(code, 'i'));
  if (index >= 0) {
    const context = source.slice(Math.max(0, index - 700), index + 1200);
    const url = context.match(/(?:https?:\/\/[^'"\s]+|\/[^'"\s]+\.(?:aspx|ashx|asmx)(?:\?[^'"\s]*)?)/i);
    if (url) return decodeHtml(url[0]);
  }
  return '';
}

function absoluteTarget(target) {
  if (!target || !String(target).startsWith('/')) return new URL(DEFAULT_TARGET, SCHOOL_ORIGIN).toString();
  const url = new URL(target, SCHOOL_ORIGIN);
  if (url.origin !== SCHOOL_ORIGIN) throw new Error('不允許的查詢網址');
  return url.toString();
}

function parseTables(html, kind) {
  const tables = [...String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(x => x[1]).filter(table => !/校務更新通知|常見問題Q&A|標為已讀不顯示|公告內容/i.test(table));
  const keywords = kind === 'rewards' ? /獎懲|獎勵|懲處|嘉獎|小功|警告/i : /出缺勤|缺勤|遲到|曠課|事假|病假/i;
  const ranked = tables.sort((a, b) => Number(keywords.test(b)) - Number(keywords.test(a)));
  for (const table of ranked) {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cell => stripTags(cell[1]))).filter(row => row.length);
    if (rows.length < 2) continue;
    const headers = rows[0].map((x, i) => x || `欄位${i + 1}`);
    return rows.slice(1).map(row => Object.fromEntries(headers.map((header, i) => [header, row[i] || ''])));
  }
  return [];
}

async function schoolFetch(url, options, stage) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  } catch (error) {
    const code = error?.cause?.code || error?.code || 'unknown';
    if (code === 'ENOTFOUND' || /fetch failed/i.test(error.message || '')) {
      try {
        return await httpsFallback(url, options);
      } catch (fallbackError) {
        const fallbackCode = fallbackError?.code || fallbackError?.cause?.code || 'unknown';
        throw new Error(`亞昕連線失敗（${stage}）：DNS 無法解析，固定 IP fallback 也失敗：${fallbackError.message || 'fetch failed'} [${fallbackCode}]`);
      }
    }
    throw new Error(`亞昕連線失敗（${stage}）：${error.message || 'fetch failed'} [${code}]`);
  }
}

function httpsFallback(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
      servername: target.hostname,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions && lookupOptions.all) return callback(null, [{ address: SCHOOL_IP, family: 4 }]);
        return callback(null, SCHOOL_IP, 4);
      },
      rejectUnauthorized: true,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const rawHeaders = response.rawHeaders || [];
        const setCookies = [];
        for (let i = 0; i < rawHeaders.length; i += 2) {
          if (String(rawHeaders[i]).toLowerCase() === 'set-cookie') setCookies.push(rawHeaders[i + 1]);
        }
        const headerMap = new Map();
        for (let i = 0; i < rawHeaders.length; i += 2) headerMap.set(String(rawHeaders[i]).toLowerCase(), rawHeaders[i + 1]);
        resolve({
          status: response.statusCode,
          headers: { get: name => headerMap.get(String(name).toLowerCase()) || null, getSetCookie: () => setCookies },
          text: async () => Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    request.setTimeout(20000, () => request.destroy(new Error('request timeout')));
    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function loginToSchool(username, password) {
  const common = { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' };
  const first = await schoolFetch(LOGIN_URL, { headers: common }, '取得登入頁');
  const firstHtml = await first.text();
  const initialCookies = mergeCookies(getSetCookieHeaders(first.headers));
  const form = new URLSearchParams({ ...hiddenFields(firstHtml), UserId: username, Pswd: password, BtnLogin: '登入', clientbrowser: 'Chrome156.0.0.0' });
  const second = await schoolFetch(LOGIN_URL, { method: 'POST', redirect: 'manual', headers: { ...common, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: initialCookies, Referer: LOGIN_URL }, body: form.toString() }, '送出登入表單');
  const secondHtml = await second.text();
  const allCookies = mergeCookies(initialCookies, getSetCookieHeaders(second.headers));
  if (!allCookies) throw new Error('亞昕未回傳登入 Cookie');
  if (looksLikeLoginFailure(secondHtml)) throw new Error('亞昕帳號或密碼錯誤');
  return { cookieHeader: allCookies, html: secondHtml };
}

async function querySchool(session, kind, suppliedTarget) {
  const firstUrl = absoluteTarget(suppliedTarget || DEFAULT_TARGET);
  const first = await schoolFetch(firstUrl, { headers: { 'User-Agent': USER_AGENT, Cookie: session.cookieHeader, Accept: 'text/html,application/xhtml+xml' } }, '取得查詢入口');
  const firstHtml = await first.text();
  const code = kind === 'rewards' ? 'DCS01' : 'DDS01';
  const target = moduleLink(firstHtml, code);
  if (!target) throw new Error(`亞昕查詢入口未提供 ${code} 功能頁，避免誤讀首頁公告`);
  const finalUrl = absoluteTarget(target);
  const response = target === firstUrl ? first : await schoolFetch(finalUrl, { headers: { 'User-Agent': USER_AGENT, Cookie: session.cookieHeader, Referer: firstUrl, Accept: 'text/html,application/xhtml+xml' } }, `取得${kind === 'rewards' ? '獎懲' : '出缺勤'}頁`);
  const html = target === firstUrl ? firstHtml : await response.text();
  return { records: parseTables(html, kind), source: finalUrl, title: kind === 'rewards' ? '獎懲查詢' : '出缺勤查詢' };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { status: 'error', message: '只允許 POST' });
  try {
    const body = parseBody(req);
    const action = String(body.action || '');
    if (action === 'login') {
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!username || !password) return json(res, 400, { status: 'error', message: '請輸入帳號與密碼' });
      const school = await loginToSchool(username, password);
      const token = encryptSession(school.cookieHeader);
      return json(res, 200, { status: 'success', message: '亞昕登入成功' }, { 'Set-Cookie': setSessionCookie(req, token) });
    }
    if (action === 'logout') return json(res, 200, { status: 'success' }, { 'Set-Cookie': clearSessionCookie(req) });
    if (action === 'rewards' || action === 'attendance') {
      const cookies = parseCookies(req.headers.cookie || '');
      const session = decryptSession(cookies[SESSION_NAME]);
      if (!session) return json(res, 401, { status: 'error', message: '登入狀態已失效，請重新登入' });
      const result = await querySchool(session, action, body.targetUrl);
      return json(res, 200, { status: 'success', ...result, records: result.records });
    }
    return json(res, 400, { status: 'error', message: '未知操作' });
  } catch (error) {
    console.error('yaxin api error:', error);
    return json(res, 502, { status: 'error', message: error.message || '亞昕系統連線失敗' });
  }
};
