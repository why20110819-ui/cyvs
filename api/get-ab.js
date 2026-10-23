export default async function handler(req, res) {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const OWNER = process.env.GITHUB_OWNER;
    const REPO = process.env.GITHUB_REPO;
    const FILE_PATH = 'ab.json';

    try {
        const getRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                // 加入避免快取的標頭
                'Cache-Control': 'no-cache'
            }
        });

        if (getRes.ok) {
            const fileData = await getRes.json();
            // GitHub API 回傳的是 Base64，需解碼回 JSON
            const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
            return res.status(200).json(JSON.parse(content));
        } else {
            return res.status(500).json({ error: '無法讀取最新資料' });
        }
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}