export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  const { text, grams } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Feedback text is required.' });
  }
  console.log('[susty feedback]', JSON.stringify({ text: text.slice(0, 500), grams, ts: new Date().toISOString() }));
  return res.status(200).json({ ok: true });
}
