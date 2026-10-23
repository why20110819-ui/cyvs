export default function handler(req, res) {
   1. 處理 Meta 的 GET 驗證請求
  if (req.method === 'GET') {
    const VERIFY_TOKEN =admin

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge);
      } else {
        return res.status(403).send('Forbidden');
      }
    }
    return res.status(400).send('Bad Request');
  }

   2. 處理接收訊息的 POST 請求
  if (req.method === 'POST') {
    const body = req.body;
    console.log('收到 Webhook 訊息：', body);
    return res.status(200).send('EVENT_RECEIVED');
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}