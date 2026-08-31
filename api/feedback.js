// Stores each feedback entry as a JSON file in Vercel Blob.
// Uses the Blob REST API directly — no npm package needed.
// Requires BLOB_READ_WRITE_TOKEN in environment variables.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only.' });
  }

  const { text, grams } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Feedback text is required.' });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.log('[susty feedback — no BLOB_READ_WRITE_TOKEN]', text);
    return res.status(200).json({ ok: true, stored: false });
  }

  const entry = JSON.stringify({
    text: text.slice(0, 2000),
    grams: typeof grams === 'number' ? +grams.toFixed(4) : null,
    ts: new Date().toISOString(),
  });

  const filename = `feedback/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

  try {
    const r = await fetch(`https://blob.vercel-storage.com/${filename}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-api-version': '7',
        'content-type': 'application/json',
      },
      body: entry,
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('Blob PUT failed', r.status, detail);
      return res.status(500).json({ error: `Blob error ${r.status}.` });
    }

    return res.status(200).json({ ok: true, stored: true });
  } catch (err) {
    console.error('Blob fetch error:', err);
    return res.status(500).json({ error: 'Could not reach Blob storage.' });
  }
}
