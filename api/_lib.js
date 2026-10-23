'use strict';
/* Julian Topup — shared backend helpers (no npm dependencies) */
const crypto = require('crypto');
const DEFAULTS = require('./_defaults.json');

/* ---------- Database: Upstash Redis (REST) ---------- */
const DB_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const DB_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const HAS_DB = !!(DB_URL && DB_TOKEN);

/* Fallback in-memory store (local test only — data is lost between requests on Vercel) */
const mem = global.__jtMem || (global.__jtMem = { kv: new Map(), z: new Map(), exp: new Map() });
function memCmd(a) {
  const c = String(a[0]).toUpperCase(), now = Date.now();
  const alive = (k) => {
    const e = mem.exp.get(k);
    if (e && e < now) { mem.kv.delete(k); mem.exp.delete(k); }
    return mem.kv.has(k);
  };
  switch (c) {
    case 'GET': return alive(a[1]) ? mem.kv.get(a[1]) : null;
    case 'MGET': return a.slice(1).map((k) => (alive(k) ? mem.kv.get(k) : null));
    case 'SET': {
      let nx = false, ex = 0;
      for (let i = 3; i < a.length; i++) {
        const o = String(a[i]).toUpperCase();
        if (o === 'NX') nx = true; else if (o === 'EX') ex = +a[++i];
      }
      if (nx && alive(a[1])) return null;
      mem.kv.set(a[1], a[2]);
      if (ex) mem.exp.set(a[1], now + ex * 1000); else mem.exp.delete(a[1]);
      return 'OK';
    }
    case 'INCR': { const v = (alive(a[1]) ? +mem.kv.get(a[1]) : 0) + 1; mem.kv.set(a[1], String(v)); return v; }
    case 'EXPIRE': mem.exp.set(a[1], now + +a[2] * 1000); return 1;
    case 'DEL': { const had = mem.kv.delete(a[1]); mem.exp.delete(a[1]); return had ? 1 : 0; }
    case 'ZADD': { const z = mem.z.get(a[1]) || new Map(); z.set(a[3], +a[2]); mem.z.set(a[1], z); return 1; }
    case 'ZREM': { const z = mem.z.get(a[1]); return z && z.delete(a[2]) ? 1 : 0; }
    case 'ZREVRANGE': {
      const arr = [...(mem.z.get(a[1]) || new Map()).entries()].sort((x, y) => y[1] - x[1]).map((e) => e[0]);
      const s = +a[2], e = +a[3];
      return arr.slice(s, e < 0 ? undefined : e + 1);
    }
  }
  throw new Error('memory db: unsupported command ' + c);
}
async function db(...args) {
  args = args.map((x) => (x !== null && typeof x === 'object' ? JSON.stringify(x) : String(x)));
  if (!HAS_DB) return memCmd(args);
  const r = await fetch(DB_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + DB_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000)
  });
  const j = await r.json();
  if (j.error) throw new Error('db: ' + j.error);
  return j.result;
}
const getJSON = async (k) => { const v = await db('GET', k); if (v == null) return null; try { return JSON.parse(v); } catch (e) { return null; } };
const setJSON = (k, v, ...opts) => db('SET', k, JSON.stringify(v), ...opts);

/* ---------- HTTP helpers ---------- */
function send(res, status, obj, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const k in headers || {}) res.setHeader(k, headers[k]);
  res.end(JSON.stringify(obj));
}
function body(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}
const ip = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'x';
async function rateLimit(req, name, max, windowSec) {
  const k = 'rl:' + name + ':' + ip(req);
  const n = await db('INCR', k);
  if (n === 1) await db('EXPIRE', k, windowSec);
  return n <= max;
}
const clean = (s, max) => String(s == null ? '' : s).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max || 100);

/* ---------- Admin auth (stateless signed token) ---------- */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const secret = () => process.env.ADMIN_SECRET || 'jt-secret:' + ADMIN_PASSWORD;
const hmac = (s) => crypto.createHmac('sha256', secret()).update(s).digest('base64url');
function safeEq(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function signToken(hours) { const exp = String(Date.now() + hours * 3600e3); return exp + '.' + hmac(exp); }
function isAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const h = String(req.headers.authorization || '');
  if (h.slice(0, 7) !== 'Bearer ') return false;
  const [exp, sig] = h.slice(7).split('.');
  if (!exp || !sig || +exp < Date.now()) return false;
  return safeEq(sig, hmac(exp));
}

/* ---------- Shop config ---------- */
async function getConfig() {
  const c = await getJSON('config');
  return c && Array.isArray(c.games) ? c : JSON.parse(JSON.stringify(DEFAULTS));
}

/* ---------- Orders ---------- */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(prefix) {
  let s = prefix;
  for (let i = 0; i < 6; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return s;
}
const getOrder = (code) => getJSON('order:' + code);
async function saveOrder(o) { await setJSON('order:' + o.code, o); }
async function listOrders(limit) {
  const codes = await db('ZREVRANGE', 'orders', 0, (limit || 100) - 1);
  if (!codes || !codes.length) return [];
  const vals = await db('MGET', ...codes.map((c) => 'order:' + c));
  return vals.map((v) => { try { return JSON.parse(v); } catch (e) { return null; } }).filter(Boolean);
}
const esc = (t) => String(t == null ? '' : t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
async function tgSend(chat, text) {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t || !chat) return;
  try {
    await fetch('https://api.telegram.org/bot' + t + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }), signal: AbortSignal.timeout(5000)
    });
  } catch (e) { /* ignore */ }
}
async function notify(text) { await tgSend(process.env.TELEGRAM_CHAT_ID, esc(text)); }
const fmtTime = (ms) => new Date(ms + 7 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + ' (ម៉ោងកម្ពុជា)';
async function notifyPaid(o, via) {
  const group = process.env.TELEGRAM_CHAT_ID, channel = process.env.TELEGRAM_CHANNEL_ID;
  if (!process.env.TELEGRAM_BOT_TOKEN || (!group && !channel)) return;
  const cfg = await getConfig().catch(() => ({ rate: 4100 }));
  const khr = Math.round((o.usd * (cfg.rate || 4100)) / 100) * 100;
  const topup = o.kind !== 'account';
  const idBlock = topup
    ? '🆔 Player ID: <code>' + esc(o.pid) + '</code>' + (o.sid ? '\n🌐 Server: <code>' + esc(o.sid) + '</code>' : '')
    : '👤 ' + esc(o.name) + '\n📞 ' + esc(o.phone) + (o.tg ? '\n✈️ ' + esc(o.tg) : '');
  const itemCode = topup ? (o.game || 'game') + '_' + (parseInt(o.packText, 10) || '') : 'ACCOUNT_' + (o.accountIdx != null ? o.accountIdx : '');
  const action = topup
    ? 'ការបញ្ជាទិញជោគជ័យ 💎✅\n\n👤 User ID: <code>' + esc(o.pid) + '</code>\n' + (o.sid ? '🌐 Server ID: <code>' + esc(o.sid) + '</code>\n' : '') +
      '🧾 itemCode: <code>' + esc(itemCode) + '</code>\n🎮 Game: ' + esc(o.gameName) + '\n📦 Item: ' + esc(o.packText) + '\n💰 Amount: $' + o.usd.toFixed(2) + '\n📋 Order ID: <code>' + esc(o.code) + '</code>'
    : 'ការបញ្ជាទិញជោគជ័យ 🛒✅\n\n👤 ' + esc(o.name) + '\n📞 ' + esc(o.phone) + (o.tg ? '\n✈️ ' + esc(o.tg) : '') +
      '\n🧾 itemCode: <code>' + esc(itemCode) + '</code>\n📦 Item: ' + esc(o.item) + '\n💰 Amount: $' + o.usd.toFixed(2) + '\n📋 Order ID: <code>' + esc(o.code) + '</code>';
  const invoice = '🧾 <b>វិក័យបត្រ / Invoice</b>\n━━━━━━━━━━━━\n' +
    'លេខ: <code>' + esc(o.code) + '</code>\nពេល: ' + fmtTime(o.paidAt || Date.now()) + '\n' +
    (topup ? 'ហ្គេម: ' + esc(o.gameName) + '\nកញ្ចប់: ' + esc(o.packText) + '\n' : 'គណនី: ' + esc(o.item) + '\n') + idBlock + '\n━━━━━━━━━━━━\n' +
    'សរុប: <b>$' + o.usd.toFixed(2) + '</b> (៛' + khr.toLocaleString('en-US') + ')\n' +
    'បង់តាម: ' + esc(o.pay || 'KHQR') + ' · ' + (via === 'admin' ? 'Admin បញ្ជាក់' : 'Bakong ស្វ័យប្រវត្តិ') + '\nស្ថានភាព: ✅ បានបង់';
  if (channel && channel !== group) { await tgSend(group, action); await tgSend(channel, invoice); }
  else await tgSend(group || channel, action + '\n\n' + invoice);
}
const orderText = (o) =>
  (o.kind === 'account' ? '🛒 គណនី' : '💎 Topup') + ' ' + o.code + '\n' + o.item +
  (o.kind === 'topup' ? '\nID: ' + o.pid + (o.sid ? ' (' + o.sid + ')' : '') : '\n' + o.name + ' · ' + o.phone + (o.tg ? ' · ' + o.tg : '')) +
  '\n$' + o.usd.toFixed(2);
async function setStatus(o, status, via) {
  const prev = o.status;
  o.status = status;
  const now = Date.now();
  if (status === 'paid' && !o.paidAt) o.paidAt = now;
  if (status === 'completed') { o.completedAt = now; if (!o.paidAt) o.paidAt = now; }
  if (via) o.via = via;
  await saveOrder(o);
  if ((status === 'paid' || status === 'completed') && prev !== 'paid' && prev !== 'completed') await notifyPaid(o, via);
  return o;
}

/* ---------- KHQR (EMV TLV) ---------- */
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) { crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1; crc &= 0xFFFF; }
  }
  return ('0000' + crc.toString(16).toUpperCase()).slice(-4);
}
function parseTLV(s) {
  const out = {};
  let i = 0;
  while (i + 4 <= s.length) {
    const tag = s.slice(i, i + 2), len = parseInt(s.slice(i + 2, i + 4), 10);
    if (isNaN(len) || i + 4 + len > s.length) return null;
    out[tag] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

module.exports = {
  DEFAULTS, HAS_DB, db, getJSON, setJSON, send, body, ip, rateLimit, clean,
  ADMIN_PASSWORD, safeEq, signToken, isAdmin, getConfig,
  newCode, getOrder, saveOrder, listOrders, setStatus, notify, orderText, crc16, parseTLV
};
