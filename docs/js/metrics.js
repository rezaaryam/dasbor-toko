/*
 * Dasbor Toko, lapisan angka.
 * Fungsi murni yang mengubah pesanan mentah menjadi angka. Tidak menyentuh DOM,
 * jadi semuanya bisa diuji di Node.
 * MIT License, Reza Arya Maulana.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DasborMetrics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DAY = 86400000;
  var BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  var BULAN_PANJANG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  var HARI = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

  /** "YYYY-MM-DD" atau "YYYY-MM-DDTHH:MM" sebagai milidetik UTC. */
  function utc(str) {
    var y = +str.slice(0, 4), m = +str.slice(5, 7) - 1, d = +str.slice(8, 10);
    var h = str.length > 10 ? +str.slice(11, 13) : 0, mi = str.length > 13 ? +str.slice(14, 16) : 0;
    return Date.UTC(y, m, d, h, mi);
  }
  function dayKey(ms) { return new Date(ms).toISOString().slice(0, 10); }

  /** Membuka JSON ringkas (columns + rows + dict) menjadi objek pesanan. */
  function decode(raw) {
    var idx = {}, dict = raw.dict;
    raw.columns.forEach(function (name, i) { idx[name] = i; });
    var refund = raw.refundStatus || dict.statuses[dict.statuses.length - 1];
    return raw.rows.map(function (r) {
      var ts = utc(r[idx.ts]);
      var d = new Date(ts);
      var status = dict.statuses[r[idx.status]];
      return {
        id: r[idx.id],
        ts: ts,
        hour: d.getUTCHours(),
        weekday: (d.getUTCDay() + 6) % 7, // Senin = 0
        channel: dict.channels[r[idx.channel]],
        category: dict.categories[r[idx.category]],
        city: dict.cities[r[idx.city]],
        items: r[idx.items],
        total: r[idx.total],
        status: status,
        refund: status === refund
      };
    });
  }

  /** Jendela `days` hari yang berakhir pada `end`, dan jendela sebelumnya. */
  function periods(end, days) {
    var endMs = typeof end === "string" ? utc(end) : end;
    var start = endMs - (days - 1) * DAY;
    return {
      current: { start: start, end: endMs + DAY - 1, days: days },
      previous: { start: start - days * DAY, end: start - 1, days: days }
    };
  }

  /** opt: { start, end, channel, status, query }, semuanya boleh kosong. */
  function filter(orders, opt) {
    opt = opt || {};
    var q = (opt.query || "").trim().toLowerCase();
    return orders.filter(function (o) {
      if (opt.start != null && o.ts < opt.start) return false;
      if (opt.end != null && o.ts > opt.end) return false;
      if (opt.channel && opt.channel !== "all" && o.channel !== opt.channel) return false;
      if (opt.status && opt.status !== "all" && o.status !== opt.status) return false;
      if (q && (o.id + " " + o.city + " " + o.category + " " + o.channel).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  /** Pendapatan dan jumlah pesanan tanpa refund; tingkat refund menghitungnya. */
  function summarize(orders) {
    var revenue = 0, count = 0, refunds = 0, items = 0;
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (o.refund) { refunds++; continue; }
      revenue += o.total; count++; items += o.items;
    }
    return {
      revenue: revenue,
      orders: count,
      aov: count ? revenue / count : 0,
      items: items,
      refundRate: orders.length ? refunds / orders.length : 0
    };
  }

  function delta(cur, prev) {
    if (!isFinite(cur) || !isFinite(prev) || prev === 0) return null;
    return (cur - prev) / Math.abs(prev);
  }

  /** Deret waktu terisi nol. bucket 1 = harian, 7 = mingguan. */
  function series(orders, start, days, bucket) {
    bucket = bucket || 1;
    var n = Math.ceil(days / bucket), out = [];
    for (var i = 0; i < n; i++) out.push({ t: start + i * bucket * DAY, value: 0, orders: 0, refunds: 0, all: 0 });
    for (var j = 0; j < orders.length; j++) {
      var o = orders[j];
      var k = Math.floor((o.ts - start) / (bucket * DAY));
      if (k < 0 || k >= n) continue;
      out[k].all++;
      if (o.refund) { out[k].refunds++; continue; }
      out[k].value += o.total;
      out[k].orders++;
    }
    return out;
  }

  /** Jumlah pendapatan per kolom, urut dari terbesar, dengan porsinya. */
  function groupSum(orders, key) {
    var map = {}, total = 0;
    orders.forEach(function (o) {
      if (o.refund) return;
      map[o[key]] = (map[o[key]] || 0) + o.total;
      total += o.total;
    });
    return Object.keys(map)
      .map(function (k) { return { key: k, value: map[k], share: total ? map[k] / total : 0 }; })
      .sort(function (a, b) { return b.value - a.value || (a.key < b.key ? -1 : 1); });
  }

  /** Jumlah pesanan per hari (baris, Senin dulu) dan blok jam (kolom). */
  function heatmap(orders, hoursPerCell) {
    hoursPerCell = hoursPerCell || 3;
    var cols = Math.ceil(24 / hoursPerCell), grid = [], max = 0, peak = null;
    for (var r = 0; r < 7; r++) { grid.push([]); for (var c = 0; c < cols; c++) grid[r].push(0); }
    orders.forEach(function (o) {
      if (o.refund) return;
      var row = o.weekday, col = Math.floor(o.hour / hoursPerCell);
      var v = ++grid[row][col];
      if (v > max) { max = v; peak = { day: row, col: col }; }
    });
    return { grid: grid, max: max, cols: cols, hoursPerCell: hoursPerCell, peak: peak };
  }

  function sortBy(list, key, dir) {
    var sign = dir === "asc" ? 1 : -1;
    return list
      .map(function (v, i) { return { v: v, i: i }; })
      .sort(function (a, b) {
        var x = a.v[key], y = b.v[key];
        if (x < y) return -sign;
        if (x > y) return sign;
        return a.i - b.i;
      })
      .map(function (w) { return w.v; });
  }

  function paginate(list, page, size) {
    var pages = Math.max(1, Math.ceil(list.length / size));
    var p = Math.min(Math.max(1, page), pages);
    return { rows: list.slice((p - 1) * size, p * size), page: p, pages: pages, total: list.length };
  }

  // ---------- format Indonesia ----------
  function num(v, digits) {
    var s = (digits ? Math.abs(v).toFixed(digits) : Math.round(Math.abs(v)).toString()).split(".");
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (v < 0 ? "-" : "") + s.join(",");
  }
  function short(x) {
    var s = Math.abs(x) >= 100 ? num(x) : num(x, 1);
    return s.replace(/,0$/, "");
  }
  /** Rp 177 jt, Rp 400 rb, Rp 1,3 M. full: Rp 6.157.000 */
  function money(v, full) {
    if (full) return "Rp " + num(v);
    var a = Math.abs(v);
    if (a >= 1e9) return "Rp " + short(v / 1e9) + " M";
    if (a >= 1e6) return "Rp " + short(v / 1e6) + " jt";
    if (a >= 1e3) return "Rp " + short(v / 1e3) + " rb";
    return "Rp " + num(v);
  }
  function percent(x, digits) {
    return num(x * 100, digits == null ? 1 : digits).replace(/,0$/, "") + "%";
  }
  /** style: "short" = 24 Okt, "long" = 24 Oktober 2026, default = 24 Okt 2026 */
  function date(ms, style) {
    var d = new Date(ms);
    if (style === "short") return d.getUTCDate() + " " + BULAN[d.getUTCMonth()];
    if (style === "long") return d.getUTCDate() + " " + BULAN_PANJANG[d.getUTCMonth()] + " " + d.getUTCFullYear();
    return d.getUTCDate() + " " + BULAN[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }

  /**
   * Bahan kalimat pembuka halaman. Mengembalikan data, bukan HTML,
   * supaya tampilan bebas menata kata mana yang ditonjolkan.
   */
  function insights(cur, prev, start, days) {
    var a = summarize(cur), b = summarize(prev);
    var ch = groupSum(cur, "channel")[0] || null;
    var hm = heatmap(cur, 3);
    var best = series(cur, start, days, 1).reduce(function (m, p) { return p.value > m.value ? p : m; }, { value: 0 });
    return {
      revenue: a.revenue,
      orders: a.orders,
      change: delta(a.revenue, b.revenue),
      topChannel: ch,
      peakSlot: hm.peak ? { day: HARI[hm.peak.day], from: hm.peak.col * 3, to: hm.peak.col * 3 + 3 } : null,
      bestDay: best.value > 0 ? best : null
    };
  }

  function toCSV(orders) {
    var head = ["id", "tanggal", "kanal", "kategori", "kota", "jumlah", "total", "status"];
    var esc = function (v) { v = String(v); return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [head.join(",")].concat(orders.map(function (o) {
      return [o.id, new Date(o.ts).toISOString().slice(0, 16).replace("T", " "), o.channel, o.category, o.city, o.items, o.total, o.status].map(esc).join(",");
    })).join("\n") + "\n";
  }

  return {
    DAY: DAY, BULAN: BULAN, HARI: HARI, utc: utc, dayKey: dayKey, decode: decode, periods: periods,
    filter: filter, summarize: summarize, delta: delta, series: series, groupSum: groupSum,
    heatmap: heatmap, sortBy: sortBy, paginate: paginate, num: num, money: money,
    percent: percent, date: date, insights: insights, toCSV: toCSV
  };
});
