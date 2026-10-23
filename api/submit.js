export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const payload = req.body;
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const OWNER = process.env.GITHUB_OWNER;
    const REPO = process.env.GITHUB_REPO;
    const FILE_PATH = 'ab.json';

    if (!GITHUB_TOKEN || !OWNER || !REPO) {
        return res.status(500).json({ error: '伺服器環境變數 (GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO) 未正確設定' });
    }

    try {
        // 1. 讀取 GitHub 目前的 ab.json 資料與 sha
        const getRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        let currentPosts = [];
        let sha = '';

        if (getRes.ok) {
            const fileData = await getRes.json();
            sha = fileData.sha;
            // UTF-8 Base64 解碼
            const contentBuffer = Buffer.from(fileData.content, 'base64').toString('utf-8');
            currentPosts = JSON.parse(contentBuffer);
        }

        // 2. 將新投稿插入最前面
        currentPosts.unshift(payload);

        // 3. UTF-8 Base64 編碼並寫回 GitHub
        const newContentBase64 = Buffer.from(JSON.stringify(currentPosts, null, 2), 'utf-8').toString('base64');

        const putRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({
                message: `新增投稿: ${payload.id}`,
                content: newContentBase64,
                sha: sha || undefined
            })
        });

        if (!putRes.ok) {
            const errData = await putRes.json();
            throw new Error(errData.message || '寫入 GitHub 失敗');
        }

        return res.status(200).json({ success: true, message: '投稿成功' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
