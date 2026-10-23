'use strict';
const L = require('./_lib');

/* Public shop config (games, prices, KHQR account, recent-order ticker). Secrets are never included. */
module.exports = async (req, res) => {
  try {
    const cfg = await L.getConfig();
    const orders = await L.listOrders(40);
    const ticker = orders
      .filter((o) => o.kind === 'topup' && (o.status === 'paid' || o.status === 'completed') && o.pid)
      .slice(0, 8)
      .map((o) => ({ n: String(o.pid).slice(0, 3) + '***', g: o.gameName, p: o.packText, t: o.paidAt || o.createdAt }));
    const pub = {
      telegram: cfg.telegram, rate: cfg.rate, khqr: cfg.khqr, pays: cfg.pays,
      games: cfg.games, accounts: cfg.accounts, logo: cfg.logo || '', banner: cfg.banner || '',
      ticker, extra: cfg.extra || null, api: true
    };
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = 200;
    res.end(JSON.stringify(pub));
  } catch (e) {
    L.send(res, 500, { error: 'server_error' });
  }
};
