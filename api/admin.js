'use strict';
const crypto = require('crypto');
const L = require('./_lib');

const STATUSES = ['pending', 'paid', 'completed', 'cancelled'];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const hex = (s) => (/^#[0-9a-f]{6}$/i.test(s) ? s : '#3355F5');
const url = (s) => { s = String(s || '').trim(); return /^(https?:\/\/|\/)[^\s<>"']*$/.test(s) ? s.slice(0, 500) : ''; };

function sanitizeConfig(c) {
  c = c || {};
  const k = c.khqr || {};
  const out = {
    telegram: L.clean(c.telegram, 40).replace(/^@/, ''),
    rate: clamp(Number(c.rate) || 4100, 1000, 10000),
    logo: url(c.logo), banner: url(c.banner),
    khqr: {
      account: L.clean(k.account, 60), name: L.clean(k.name, 25) || 'Julian Topup', city: L.clean(k.city, 15) || 'Phnom Penh',
      currency: k.currency === 'KHR' ? 'KHR' : 'USD', expireMin: clamp(Number(k.expireMin) || 15, 1, 120),
      mcc: L.clean(k.mcc, 4) || '5999', merchantId: L.clean(k.merchantId, 40), bank: L.clean(k.bank, 40)
    },
    pays: (Array.isArray(c.pays) ? c.pays : []).slice(0, 10)
      .map((p) => ({ name: L.clean(p.name, 30), desc: L.clean(p.desc, 80), mono: L.clean(p.mono, 4), tint: hex(p.tint), img: url(p.img) }))
      .filter((p) => p.name),
    games: [], accounts: []
  };
  const x = c.extra || {};
  out.extra = {
    logoTopup: url(x.logoTopup), logoAccount: url(x.logoAccount), accent: /^#[0-9a-f]{6}$/i.test(x.accent) ? x.accent : '',
    t: Object.fromEntries(Object.entries(x.t && typeof x.t === 'object' ? x.t : {}).slice(0, 60).map(([k, v]) => [L.clean(k, 30), L.clean(v, 300)])),
    banners: (Array.isArray(x.banners) ? x.banners : []).slice(0, 10).map((b) => ({ img: url(b.img), game: L.clean(b.game, 30), url: url(b.url) })).filter((b) => b.img)
  };
  if (!out.pays.length) out.pays = L.DEFAULTS.pays;
  const seen = new Set();
  for (const g of (Array.isArray(c.games) ? c.games : []).slice(0, 60)) {
    const id = L.clean(g.id, 30).replace(/[^\w-]/g, '');
    if (!id || seen.has(id)) throw new Error('ID ហ្គេមមិនត្រឹមត្រូវ ឬស្ទួន: ' + (g.id || '(ទទេ)'));
    seen.add(id);
    const packs = (Array.isArray(g.packs) ? g.packs : []).slice(0, 40).map((p) => {
      const r = [Math.round(Number(p[0])), Math.round(Number(p[1]) * 100) / 100];
      if (!(r[0] > 0) || !(r[1] > 0)) throw new Error('កញ្ចប់មិនត្រឹមត្រូវក្នុង ' + id);
      if (url(p[2])) r.push(url(p[2]));
      return r;
    });
    if (!packs.length) throw new Error('ហ្គេម ' + id + ' ត្រូវមានយ៉ាងហោចណាស់ ១ កញ្ចប់');
    const o = {
      id, short: L.clean(g.short, 30) || id, name: L.clean(g.name, 40) || id, region: L.clean(g.region, 20),
      mono: L.clean(g.mono, 3), tint: hex(g.tint), unit: L.clean(g.unit, 20), unitKm: L.clean(g.unitKm, 20),
      vizo: L.clean(g.vizo, 40).replace(/[^\w.-]/g, ''), server: !!g.server, idType: g.idType === 'text' ? 'text' : 'num', pop: Number.isFinite(Number(g.pop)) ? clamp(Math.round(Number(g.pop)), 0, 39) : 2, packs
    };
    if (url(g.img)) o.img = url(g.img);
    if (url(g.packImg)) o.packImg = url(g.packImg);
    out.games.push(o);
  }
  for (const a of (Array.isArray(c.accounts) ? c.accounts : []).slice(0, 100)) {
    if (!seen.has(a.game)) throw new Error('គណនី "' + L.clean(a.title, 40) + '" ភ្ជាប់ទៅហ្គេមដែលមិនមាន');
    const usd = Math.round(Number(a.usd) * 100) / 100;
    if (!(usd > 0)) throw new Error('តម្លៃគណនីមិនត្រឹមត្រូវ: ' + L.clean(a.title, 40));
    out.accounts.push({
      game: a.game, title: L.clean(a.title, 80), usd,
      specs: (Array.isArray(a.specs) ? a.specs : []).slice(0, 8).map((s) => L.clean(s, 40)).filter(Boolean),
      images: (Array.isArray(a.images) ? a.images : []).slice(0, 10).map(url).filter(Boolean)
    });
  }
  return out;
}

const actions = {
  async login(req, res, b) {
    if (!L.ADMIN_PASSWORD) return L.send(res, 503, { error: 'no_password', message: 'មិនទាន់កំណត់ ADMIN_PASSWORD ក្នុង Vercel ទេ' });
    if (!(await L.rateLimit(req, 'login', 10, 900))) return L.send(res, 429, { error: 'too_many', message: 'ព្យាយាមច្រើនពេក សូមរង់ចាំ ១៥ នាទី' });
    if (!L.safeEq(String(b.password || ''), L.ADMIN_PASSWORD)) return L.send(res, 401, { error: 'bad_password', message: 'ពាក្យសម្ងាត់មិនត្រឹមត្រូវ' });
    L.send(res, 200, { token: L.signToken(12) });
  },
  async orders(req, res) {
    L.send(res, 200, { orders: await L.listOrders(300) });
  },
  async updateOrder(req, res, b) {
    const o = await L.getOrder(L.clean(b.code, 20));
    if (!o) return L.send(res, 404, { error: 'not_found' });
    if (!STATUSES.includes(b.status)) return L.send(res, 400, { error: 'bad_status' });
    await L.setStatus(o, b.status, 'admin');
    L.send(res, 200, { order: o });
  },
  async getConfig(req, res) {
    L.send(res, 200, {
      config: await L.getConfig(),
      env: { db: L.HAS_DB, bakong: !!process.env.BAKONG_TOKEN, telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID), vizo: !!process.env.VIZO_API_KEY }
    });
  },
  async saveConfig(req, res, b) {
    let c;
    try { c = sanitizeConfig(b.config); } catch (e) { return L.send(res, 400, { error: 'invalid', message: e.message }); }
    if (b.ui && typeof b.ui === 'object' && JSON.stringify(b.ui).length < 500000) c.ui = b.ui;
    await L.setJSON('config', c);
    L.send(res, 200, { config: c });
  },
  async resetConfig(req, res) {
    await L.db('DEL', 'config');
    L.send(res, 200, { config: await L.getConfig() });
  },
  async vizoGames(req, res) {
    const key = process.env.VIZO_API_KEY;
    if (!key) return L.send(res, 400, { error: 'no_key', message: 'មិនទាន់កំណត់ VIZO_API_KEY ក្នុង Vercel' });
    const base = process.env.VIZO_API_URL || 'https://api.vizoapp.store';
    const r = await fetch(base + '/api/v1/catalogue/categories', { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(j)) return L.send(res, 502, { error: 'vizo_error', message: 'Vizo ឆ្លើយមិនត្រឹមត្រូវ (' + r.status + ')' });
    L.send(res, 200, { games: j.map((x) => ({ code: x.game_code, name: x.name, fields: x.game_fields })) });
  },
  async putOrder(req, res, b) {
    const code = L.clean(b.code, 20).replace(/[^\w-]/g, '');
    if (!code || !STATUSES.includes(b.status)) return L.send(res, 400, { error: 'bad_order' });
    const prev = await L.getOrder(code);
    if (prev) {
      if (b.status !== prev.status) await L.setStatus(prev, b.status, 'admin');
      if (prev.kind !== 'account' && b.note != null) { prev.note = L.clean(b.note, 300); await L.saveOrder(prev); }
      return L.send(res, 200, { ok: true });
    }
    const usd = Math.round(Number(b.usd) * 100) / 100;
    if (!(usd > 0)) return L.send(res, 400, { error: 'bad_price', message: 'តម្លៃមិនត្រឹមត្រូវ' });
    const now = Date.now(), at = Number(b.createdAt) > 0 ? Math.min(Number(b.createdAt), now) : now;
    const o = { kind: 'topup', usd, game: L.clean(b.game, 30), gameName: L.clean(b.gameName, 60), pid: L.clean(b.pid, 40), sid: L.clean(b.sid, 10),
      packText: L.clean(b.packText, 40), item: L.clean(b.item, 120), pay: L.clean(b.pay, 20), name: L.clean(b.name, 60), note: L.clean(b.note, 300),
      status: 'pending', createdAt: at, md5s: [], code, via: 'admin' };
    if ((await L.setJSON('order:' + code, o, 'NX')) !== 'OK') return L.send(res, 409, { error: 'exists' });
    await L.db('ZADD', 'orders', at, code);
    if (b.status !== 'pending') await L.setStatus(o, b.status, 'admin');
    L.send(res, 200, { ok: true });
  },
  async deleteOrder(req, res, b) {
    const code = L.clean(b.code, 20).replace(/[^\w-]/g, '');
    if (!code) return L.send(res, 400, { error: 'bad_order' });
    await L.db('DEL', 'order:' + code);
    await L.db('ZREM', 'orders', code);
    L.send(res, 200, { ok: true });
  },
  async upload(req, res, b) {
    const d = String(b.data || '');
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,[A-Za-z0-9+/=]+$/.exec(d);
    if (!m || d.length > 700000) return L.send(res, 400, { error: 'bad_image', message: 'រូបភាពមិនត្រឹមត្រូវ ឬធំពេក' });
    const k = crypto.createHash('sha256').update(d).digest('hex').slice(0, 24);
    await L.db('SET', 'img:' + k, d);
    L.send(res, 200, { url: '/api/img?k=' + k });
  }
};

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return L.send(res, 405, { error: 'method_not_allowed' });
    const b = L.body(req), fn = actions[b.action];
    if (!fn) return L.send(res, 400, { error: 'bad_action' });
    if (b.action !== 'login' && !L.isAdmin(req)) return L.send(res, 401, { error: 'unauthorized' });
    await fn(req, res, b);
  } catch (e) {
    console.error(e);
    L.send(res, 500, { error: 'server_error' });
  }
};
