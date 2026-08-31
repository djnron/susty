import { put } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only.' });
  }

  const { text, grams } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Feedback text is required.' });
  }

  const entry = {
    text: text.slice(0, 2000),
    grams: typeof grams === 'number' ? +grams.toFixed(4) : null,
    ts: new Date().toISOString(),
  };

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.log('[susty feedback — no Blob token configured]', JSON.stringify(entry));
    return res.status(200).json({ ok: true, stored: false });
  }

  const pathname = `feedback/${entry.ts.replace(/[:.]/g, '-')}.json`;

  try {
    await put(pathname, JSON.stringify(entry), {
      access: 'public',
      contentType: 'application/json',
    });
    return res.status(200).json({ ok: true, stored: true });
  } catch (err) {
    console.error('Blob error:', err);
    return res.status(500).json({ error: 'Could not save feedback.' });
  }
}
