// 用法：node build-os.js   （需要先 npm i esbuild）
// 讀取 app.src.js → 壓縮 + 變數名稱混淆 → 編碼打包 → 輸出到上一層的 os（也就是 data/os）
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const SRC = path.join(__dirname, 'app.src.js');
const OUT = process.argv[2] || path.join(__dirname, '..', 'os');

const src = fs.readFileSync(SRC, 'utf8');
const min = esbuild.transformSync(src, {
  minify: true,            // 移除空白/註解、縮短區域變數名稱
  target: 'es2019',
  legalComments: 'none'
}).code.trim();

// 以隨機 16 字元金鑰做 XOR + base64，並附上 FNV-1a 檢查碼（檔案損毀或被改動時載入器會拒絕執行）
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
let key = '';
for (let i = 0; i < 16; i++) key += chars[Math.floor(Math.random() * chars.length)];

const bytes = Buffer.from(min, 'utf8');
const enc = Buffer.alloc(bytes.length);
let h = 2166136261 >>> 0;
for (let i = 0; i < bytes.length; i++) {
  h = Math.imul(h ^ bytes[i], 16777619) >>> 0;
  enc[i] = bytes[i] ^ key.charCodeAt(i % 16) ^ ((i * 7) & 255);
}
const out = key + h.toString(16).padStart(8, '0') + enc.toString('base64');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`原始 ${src.length} 字元 → 壓縮 ${min.length} → 輸出 ${out.length} 字元：${OUT}`);
