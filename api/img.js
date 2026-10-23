'use strict';
const L = require('./_lib');

/* Serves images uploaded from the admin panel (stored in the database as data URIs) */
module.exports = async (req, res) => {
  try {
    const k = new URL(req.url, 'http://x').searchParams.get('k') || '';
    if (!/^[a-f0-9]{16,40}$/.test(k)) return L.send(res, 404, { error: 'not_found' });
    const v = await L.db('GET', 'img:' + k);
    const m = v && /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(v);
    if (!m) return L.send(res, 404, { error: 'not_found' });
    res.statusCode = 200;
    res.setHeader('Content-Type', m[1]);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(Buffer.from(m[2], 'base64'));
  } catch (e) {
    L.send(res, 500, { error: 'server_error' });
  }
};
