'use strict';
const L = require('./_lib');

/* ឆែកឈ្មោះគណនីហ្គេមតាម Vizo API (key នៅលើ server ប៉ុណ្ណោះ — VIZO_API_KEY) */
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return L.send(res, 405, { error: 'method_not_allowed' });
    const key = process.env.VIZO_API_KEY;
    if (!key) return L.send(res, 200, { unavailable: true });
    if (!(await L.rateLimit(req, 'chk', 30, 600))) return L.send(res, 429, { error: 'too_many_requests' });
    const b = L.body(req), cfg = await L.getConfig();
    const g = cfg.games.find((x) => x.id === b.game);
    if (!g || !g.vizo) return L.send(res, 200, { unavailable: true });
    const pid = L.clean(b.pid, 40), sid = L.clean(b.sid, 10);
    if (g.idType === 'text' ? !/^[\w .\-]{2,40}$/.test(pid) : !/^\d{4,15}$/.test(pid)) return L.send(res, 400, { error: 'bad_id' });
    if (g.server && !/^\d{1,8}$/.test(sid)) return L.send(res, 400, { error: 'bad_server' });
    const payload = { game: g.vizo, user_id: pid };
    if (g.server) payload.server_id = sid;
    const base = process.env.VIZO_API_URL || 'https://api.vizoapp.store';
    let j = null;
    try {
      const r = await fetch(base + '/api/v1/orders/check_player', {
        method: 'POST', headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(8000)
      });
      j = await r.json().catch(() => null);
      if (!r.ok && r.status !== 404) j = null; // 401/424/500 → service problem, not "player not found"
    } catch (e) { j = null; }
    if (j && j.valid === 'valid' && j.name) return L.send(res, 200, { name: L.clean(j.name, 60) });
    if (j && j.valid === 'invalid') return L.send(res, 200, { name: null });
    L.send(res, 200, { unavailable: true });
  } catch (e) {
    console.error(e);
    L.send(res, 200, { unavailable: true });
  }
};
