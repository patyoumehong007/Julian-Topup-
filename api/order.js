'use strict';
const crypto = require('crypto');
const L = require('./_lib');

/* Ask Bakong (NBC) whether a KHQR transaction with this md5 was paid. Needs BAKONG_TOKEN. */
async function bakongPaid(md5, o) {
  const token = process.env.BAKONG_TOKEN;
  if (!token) return false;
  const url = process.env.BAKONG_API_URL || 'https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ md5 }),
    signal: AbortSignal.timeout(6000)
  });
  const j = await r.json().catch(() => null);
  if (!j || j.responseCode !== 0 || !j.data) return false;
  const d = j.data;
  if (d.amount != null && Math.abs(Number(d.amount) - Number(o.amount)) > 0.009) return false;
  if (d.currency && o.currency && d.currency !== o.currency) return false;
  return true;
}

async function create(req, res) {
  if (!(await L.rateLimit(req, 'order', 20, 3600))) return L.send(res, 429, { error: 'too_many_requests' });
  const b = L.body(req), cfg = await L.getConfig();
  const now = Date.now();
  let o;
  if (b.kind === 'account') {
    const a = cfg.accounts[Number(b.idx)];
    if (!a || !Number.isInteger(Number(b.idx))) return L.send(res, 400, { error: 'bad_item' });
    const name = L.clean(b.name, 60), phone = L.clean(b.phone, 20);
    if (name.length < 2 || !/^\+?\d[\d ]{7,14}$/.test(phone)) return L.send(res, 400, { error: 'bad_contact' });
    o = { kind: 'account', usd: Number(a.usd), item: a.title, accountIdx: Number(b.idx), name, phone, tg: L.clean(b.tg, 60), note: L.clean(b.note, 300), pay: 'KHQR' };
  } else {
    const g = cfg.games.find((x) => x.id === b.game);
    const p = g && g.packs[Number(b.pack)];
    if (!g || !p || !Number.isInteger(Number(b.pack))) return L.send(res, 400, { error: 'bad_item' });
    const pid = L.clean(b.pid, 40), sid = L.clean(b.sid, 10);
    if (g.idType === 'text' ? !/^[\w .\-]{2,40}$/.test(pid) : !/^\d{4,15}$/.test(pid)) return L.send(res, 400, { error: 'bad_id' });
    if (g.server && !/^\d{1,8}$/.test(sid)) return L.send(res, 400, { error: 'bad_server' });
    o = {
      kind: 'topup', usd: Number(p[1]), game: g.id, gameName: g.name + ' ' + g.region, pid, sid: g.server ? sid : '',
      item: g.name + ' ' + g.region + ' · ' + p[0] + ' ' + g.unit, packText: p[0] + ' ' + g.unitKm, pay: L.clean(b.pay, 20)
    };
  }
  if (!(o.usd > 0)) return L.send(res, 400, { error: 'bad_price' });
  o.status = 'pending'; o.createdAt = now; o.md5s = [];
  for (let i = 0; i < 6; i++) {
    o.code = L.newCode(o.kind === 'account' ? 'JA-' : 'JL-');
    if ((await L.setJSON('order:' + o.code, o, 'NX')) === 'OK') {
      await L.db('ZADD', 'orders', now, o.code);
      return L.send(res, 200, { code: o.code, usd: o.usd });
    }
  }
  L.send(res, 500, { error: 'code_failed' });
}

/* The browser builds the KHQR; the server checks it really pays THIS order to OUR account, then remembers its md5 */
async function registerQR(req, res) {
  if (!(await L.rateLimit(req, 'qr', 60, 3600))) return L.send(res, 429, { error: 'too_many_requests' });
  const b = L.body(req), o = await L.getOrder(L.clean(b.code, 20));
  if (!o) return L.send(res, 404, { error: 'not_found' });
  if (o.status !== 'pending') return L.send(res, 200, { status: o.status });
  const cfg = await L.getConfig(), k = cfg.khqr;
  if (!k.account) return L.send(res, 200, { ok: true, verifiable: false });
  const q = String(b.qr || '');
  if (q.length < 30 || q.length > 500 || q.slice(-4) !== L.crc16(q.slice(0, -4))) return L.send(res, 400, { error: 'bad_qr' });
  const t = L.parseTLV(q), sub = t && L.parseTLV(t['29'] || t['30'] || ''), bill = t && L.parseTLV(t['62'] || '');
  const amount = k.currency === 'KHR' ? String(Math.round((o.usd * cfg.rate) / 100) * 100) : o.usd.toFixed(2);
  if (!t || !sub || sub['00'] !== k.account || t['54'] !== amount || t['53'] !== (k.currency === 'KHR' ? '116' : '840') || !bill || bill['01'] !== o.code)
    return L.send(res, 400, { error: 'qr_mismatch' });
  const md5 = crypto.createHash('md5').update(q).digest('hex');
  if (!o.md5s.includes(md5)) {
    o.md5s = o.md5s.concat(md5).slice(-10); o.currency = k.currency; o.amount = amount;
    await L.saveOrder(o);
  }
  L.send(res, 200, { ok: true, verifiable: true });
}

async function status(req, res) {
  if (!(await L.rateLimit(req, 'status', 90, 60))) return L.send(res, 429, { error: 'too_many_requests' });
  const code = String(new URL(req.url, 'http://x').searchParams.get('code') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
  let o = await L.getOrder(code);
  if (!o) return L.send(res, 404, { error: 'not_found' });
  if (o.status === 'pending' && o.md5s && o.md5s.length && process.env.BAKONG_TOKEN) {
    if ((await L.db('SET', 'chk:' + code, '1', 'NX', 'EX', 3)) === 'OK') {
      for (const md5 of o.md5s.slice(-3)) {
        let ok = false;
        try { ok = await bakongPaid(md5, o); } catch (e) { /* network error: try again next poll */ }
        if (ok) { o = await L.setStatus((await L.getOrder(code)) || o, 'paid', 'bakong'); break; }
      }
    }
  }
  L.send(res, 200, { status: o.status });
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') return await create(req, res);
    if (req.method === 'PUT') return await registerQR(req, res);
    if (req.method === 'GET') return await status(req, res);
    L.send(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    console.error(e);
    L.send(res, 500, { error: 'server_error' });
  }
};
