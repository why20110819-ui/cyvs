export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { imageUrl, caption } = req.body;
    const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
    const IG_USER_ID = process.env.IG_USER_ID;

    try {
        // 1. 建立 IG Container
        const containerRes = await fetch(`https://graph.facebook.com/v19.0/${IG_USER_ID}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption)}&access_token=${IG_ACCESS_TOKEN}`, {
            method: 'POST'
        });
        const containerData = await containerRes.json();

        if (!containerData.id) throw new Error(containerData.error?.message || 'Container creation failed');

        // 2. 發布 Container 至 IG
        const publishRes = await fetch(`https://graph.facebook.com/v19.0/${IG_USER_ID}/media_publish?creation_id=${containerData.id}&access_token=${IG_ACCESS_TOKEN}`, {
            method: 'POST'
        });
        const publishData = await publishRes.json();

        return res.status(200).json({ success: true, postId: publishData.id });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
}