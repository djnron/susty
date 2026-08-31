// Feedback storage — writes each entry as a JSON file to Vercel Blob.
// Set up: Vercel dashboard → Storage → Create → Blob Store → Connect to project.
// That auto-sets BLOB_READ_WRITE_TOKEN as an env var.
// Without it, feedback is logged to console only (no crash).

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

  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (!token) {
    console.log('[susty feedback — no Blob token configured]', JSON.stringify(entry));
    return res.status(200).json({ ok: true, stored: false });
  }

  const filename = `feedback/${entry.ts.replace(/[:.]/g, '-')}.json`;

  try {
    const r = await fetch(`https://blob.vercel-storage.com/${filename}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-api-version': '7',
        'content-type': 'application/json',
      },
      body: JSON.stringify(entry),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('Blob write failed', r.status, err);
      return res.status(500).json({ error: 'Could not save feedback.' });
    }

    return res.status(200).json({ ok: true, stored: true });
  } catch (err) {
    console.error('Blob error:', err);
    return res.status(500).json({ error: 'Could not save feedback.' });
  }
}
