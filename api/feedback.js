// Feedback storage — writes to Vercel KV (Upstash Redis).
// Set up: Vercel dashboard → Storage → Create → KV Database → Connect to project.
// That auto-sets KV_REST_API_URL and KV_REST_API_TOKEN as env vars.
// Without those vars, feedback is logged to console only (no crash).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only.' });
  }

  const { text, grams } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Feedback text is required.' });
  }

  const entry = JSON.stringify({
    text: text.slice(0, 2000),
    grams: typeof grams === 'number' ? +grams.toFixed(4) : null,
    ts: new Date().toISOString(),
    ip: ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || 'unknown',
  });

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    console.log('[susty feedback — no KV configured]', entry);
    return res.status(200).json({ ok: true, stored: false });
  }

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(['LPUSH', 'susty:feedback', entry]),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('KV write failed', r.status, err);
      return res.status(500).json({ error: 'Could not save feedback.' });
    }
    return res.status(200).json({ ok: true, stored: true });
  } catch (err) {
    console.error('KV error:', err);
    return res.status(500).json({ error: 'Could not save feedback.' });
  }
}
