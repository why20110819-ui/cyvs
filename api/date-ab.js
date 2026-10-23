export default async function handler(req, res) {
    // 限制只能使用 POST 請求
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 這裡的 payload 是 admin.html 傳過來的「已經刪除特定貼文後」的完整陣列
    const payload = req.body; 
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const OWNER = process.env.GITHUB_OWNER;
    const REPO = process.env.GITHUB_REPO;
    const FILE_PATH = 'ab.json';

    if (!GITHUB_TOKEN || !OWNER || !REPO) {
        return res.status(500).json({ error: '伺服器環境變數 (GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO) 未正確設定' });
    }

    try {
        // 1. 讀取 GitHub 目前的 ab.json 資料，以取得必須的 sha 碼
        const getRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        let sha = '';
        if (getRes.ok) {
            const fileData = await getRes.json();
            sha = fileData.sha; // 必須要有 sha 才能更新/覆寫現有檔案
        } else {
            return res.status(500).json({ error: '無法讀取遠端檔案以取得 sha' });
        }

        // 2. 將前端傳來的新陣列轉為 UTF-8 Base64 編碼
        const newContentBase64 = Buffer.from(JSON.stringify(payload, null, 2), 'utf-8').toString('base64');

        // 3. 寫回 GitHub（直接覆寫整個檔案）
        const putRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({
                message: '系統操作: 更新/刪除投稿',
                content: newContentBase64,
                sha: sha // 傳入舊檔案的 sha 才能成功覆寫
            })
        });

        if (!putRes.ok) {
            const errData = await putRes.json();
            throw new Error(errData.message || '寫入 GitHub 失敗');
        }

        return res.status(200).json({ success: true, message: '同步更新成功' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
