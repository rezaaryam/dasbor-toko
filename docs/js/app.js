/*
 * Dasbor Toko, lapisan aplikasi.
 * Memuat JSON, menyimpan filter di URL, lalu menggambar ulang.
 * MIT License, Reza Arya Maulana.
 */
(function () {
  "use strict";

  var M = window.DasborMetrics, C = window.DasborCharts;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var RANGES = [7, 30, 90, 365];
  var PAGE = 12;
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Warna kanal tetap, jadi filter tidak pernah mengecat ulang kanal yang tersisa.
  var COLORS = {};
  var SLOTS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)"];
  var STATUS = {}; // nama status -> { cls, icon }
  var ICONS = [
    '<path d="m5 12.5 4.2 4.2L19 7"/>',
    '<path d="M3 7.5h11v8.5H3zM14 10.5h3.6l3.4 3.2v2.3h-7"/><circle cx="7" cy="17.6" r="1.7"/><circle cx="17" cy="17.6" r="1.7"/>',
    '<circle cx="12" cy="12" r="8"/><path d="M12 7.8V12l2.8 1.8"/>',
    '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'
  ];

  var all = [], end = 0, store = "";
  var qs = new URLSearchParams(location.search);
  var state = {
    days: RANGES.indexOf(+qs.get("rentang")) > -1 ? +qs.get("rentang") : 30,
    channel: qs.get("kanal") || "all",
    query: "", status: "all", sort: "ts", dir: "desc", page: 1
  };

  // ---------- tema ----------
  $("#tema").addEventListener("click", function () {
    var d = document.documentElement;
    var dark = d.getAttribute("data-theme") === "dark" ||
      (!d.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    var next = dark ? "light" : "dark";
    d.setAttribute("data-theme", next);
    try { localStorage.setItem("dasbor-toko-tema", next); } catch (e) {}
  });

  // ---------- muncul saat discroll ----------
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add("in");
      io.unobserve(e.target);
      if (e.target.contains($("#trend"))) drawTrend(true);
    });
  }, { threshold: 0.18, rootMargin: "0px 0px -6% 0px" }) : null;
  $$(".rv").forEach(function (n) { if (io) io.observe(n); else n.classList.add("in"); });

  // ---------- muat data ----------
  fetch("data/orders.json")
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (raw) {
      all = M.decode(raw);
      end = M.utc(raw.end);
      store = "Senja Roastery";
      raw.dict.channels.forEach(function (ch, i) {
        COLORS[ch] = SLOTS[i % SLOTS.length];
        var o = document.createElement("option");
        o.value = o.textContent = ch;
        $("#channel").appendChild(o);
      });
      raw.dict.statuses.forEach(function (st, i) {
        STATUS[st] = { cls: "st-" + i, icon: ICONS[i] || ICONS[0] };
        var o = document.createElement("option");
        o.value = o.textContent = st;
        $("#status").appendChild(o);
      });
      if (raw.dict.channels.indexOf(state.channel) === -1) state.channel = "all";
      var d = new Date(end);
      $("#edition").textContent = "Edisi " + M.date(end);
      $("#kicker").textContent = "Laporan " + M.HARI[(d.getUTCDay() + 6) % 7] + ", " + M.date(end, "long");
      bind();
      render(true);
    })
    .catch(function () {
      $("#judul").textContent = "Data belum bisa dimuat.";
      $("#notes").innerHTML = "<div><dt>Penyebab umum</dt><dd>Halaman dibuka langsung sebagai berkas. Jalankan lewat server lokal, misalnya <code>npx serve docs</code>.</dd></div>";
    });

  // ---------- kejadian ----------
  function bind() {
    $("#range").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-days]");
      if (!b || +b.getAttribute("data-days") === state.days) return;
      state.days = +b.getAttribute("data-days");
      state.page = 1;
      render();
    });
    $("#range").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var i = RANGES.indexOf(state.days) + (e.key === "ArrowRight" ? 1 : -1);
      if (i < 0 || i >= RANGES.length) return;
      state.days = RANGES[i]; state.page = 1; render();
      $('#range button[data-days="' + state.days + '"]').focus();
    });
    $("#channel").addEventListener("change", function (e) { state.channel = e.target.value; state.page = 1; render(); });
    $("#status").addEventListener("change", function (e) { state.status = e.target.value; state.page = 1; renderTable(); });
    var t;
    $("#q").addEventListener("input", function (e) {
      clearTimeout(t);
      t = setTimeout(function () { state.query = e.target.value; state.page = 1; renderTable(); }, 120);
    });
    document.querySelector(".ledger thead").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-sort]");
      if (!b) return;
      var k = b.getAttribute("data-sort");
      state.dir = state.sort === k && state.dir === "desc" ? "asc" : "desc";
      state.sort = k;
      renderTable();
    });
    $("#prev").addEventListener("click", function () { state.page--; renderTable(true); });
    $("#next").addEventListener("click", function () { state.page++; renderTable(true); });
    $("#csv").addEventListener("click", exportCSV);
    $("#channels").addEventListener("click", function (e) {
      var li = e.target.closest(".bar");
      if (!li) return;
      var key = li.getAttribute("data-key");
      state.channel = state.channel === key ? "all" : key;
      state.page = 1;
      C.hideTip();
      render();
    });
    $("#channels").addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && e.target.closest(".bar")) { e.preventDefault(); e.target.click(); }
    });

    var lastW = 0;
    if ("ResizeObserver" in window) {
      new ResizeObserver(function (en) {
        var w = Math.round(en[0].contentRect.width);
        if (lastW && w !== lastW) drawTrend(false);
        lastW = w;
      }).observe($("#trend"));
    }
  }

  // ---------- data turunan ----------
  var v = {};
  function compute() {
    var p = M.periods(end, state.days);
    v.p = p;
    v.cur = M.filter(all, { start: p.current.start, end: p.current.end, channel: state.channel });
    v.prev = M.filter(all, { start: p.previous.start, end: p.previous.end, channel: state.channel });
    // Batang kanal mengabaikan filter kanal supaya kanal lain tetap terlihat dan bisa dipilih.
    v.allCh = M.filter(all, { start: p.current.start, end: p.current.end });
    v.bucket = state.days > 90 ? 7 : 1;
  }

  function render(first) {
    compute();
    syncControls();
    renderLede();
    renderKPIs(first);
    drawTrend(!first);
    C.bars($("#channels"), M.groupSum(v.allCh, "channel"), { colors: COLORS, active: state.channel !== "all" ? state.channel : null });
    $$("#channels .bar").forEach(function (li) {
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.setAttribute("aria-pressed", String(state.channel === li.getAttribute("data-key")));
    });
    C.heatmap($("#heat"), M.heatmap(v.cur, 3));
    C.bars($("#categories"), M.groupSum(v.cur, "category").slice(0, 5), { rank: true });
    C.bars($("#cities"), M.groupSum(v.cur, "city").slice(0, 5), { rank: true });
    renderTable();
    if (!first) $$(".block, .kpis").forEach(function (n) { n.classList.remove("swap"); void n.offsetWidth; n.classList.add("swap"); });
  }

  function rangeText(days) { return days === 365 ? "12 bulan terakhir" : days + " hari terakhir"; }

  function syncControls() {
    $$("#range button").forEach(function (b) {
      var on = +b.getAttribute("data-days") === state.days;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $("#channel").value = state.channel;
    $("#trendHint").textContent = (v.bucket > 1 ? "Pendapatan mingguan" : "Pendapatan harian") + ", " + rangeText(state.days) + ", tanpa refund";
    var q = new URLSearchParams();
    if (state.days !== 30) q.set("rentang", state.days);
    if (state.channel !== "all") q.set("kanal", state.channel);
    var s = q.toString();
    history.replaceState(null, "", s ? "?" + s : location.pathname);
  }

  // ---------- pembuka: kalimat yang ditulis dari data ----------
  function renderLede() {
    var ins = M.insights(v.cur, v.prev, v.p.current.start, state.days);
    var who = state.channel === "all" ? "Pendapatan " : "Pendapatan dari " + state.channel.toLowerCase() + " ";
    var ch = ins.change;
    var move = ch === null ? "" : Math.abs(ch) < 0.005 ? ', <span class="flat">nyaris sama</span> dengan periode sebelumnya'
      : ', <span class="' + (ch > 0 ? "up" : "down") + '">' + (ch > 0 ? "naik " : "turun ") + '<span class="n">' + M.percent(Math.abs(ch)) + "</span></span>";
    $("#judul").innerHTML = who + rangeText(state.days).replace(/^(\d+)/, '<span class="n">$1</span>') + ' <span class="n" id="judulRp">' + M.money(ins.revenue) + "</span>" + move + ".";
    countUp($("#judulRp"), ins.revenue, M.money);

    var notes = [];
    if (state.channel === "all" && ins.topChannel) {
      notes.push(["Kanal terbesar", ins.topChannel.key, M.percent(ins.topChannel.share, 0) + " dari pendapatan"]);
    } else {
      notes.push(["Pesanan", M.num(ins.orders) + " pesanan", "rata-rata " + M.money(ins.orders ? ins.revenue / ins.orders : 0)]);
    }
    if (ins.peakSlot) notes.push(["Paling ramai", ins.peakSlot.day, pad(ins.peakSlot.from) + ".00 sampai " + pad(ins.peakSlot.to % 24) + ".00"]);
    if (ins.bestDay) notes.push(["Hari terbaik", M.date(ins.bestDay.t), M.money(ins.bestDay.value) + " dalam sehari"]);
    $("#notes").innerHTML = notes.map(function (n) {
      return "<div><dt>" + n[0] + "</dt><dd><b>" + esc(n[1]) + "</b><span>" + esc(n[2]) + "</span></dd></div>";
    }).join("");
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // ---------- angka yang menghitung naik ----------
  var shown = new WeakMap();
  function countUp(node, to, fmt) {
    if (!node) return;
    var from = shown.get(node) || 0;
    shown.set(node, to);
    var put = function (x) { if (node.classList.contains("kpi-v")) node.innerHTML = units(fmt(x)); else node.textContent = fmt(x); };
    if (reduce || from === to) { put(to); return; }
    var t0 = performance.now(), dur = from ? 600 : 1100;
    (function tick(now) {
      var k = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      put(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }

  /** "Rp 177 jt" menjadi Rp dan jt kecil supaya angkanya yang menonjol. */
  function units(str) {
    return str.replace(/^Rp /, '<span class="u">Rp</span>').replace(/ (jt|rb|M)$/, '<span class="u">$1</span>').replace(/%$/, '<span class="u">%</span>');
  }

  // ---------- kartu angka ----------
  var UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';
  var DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 9v8H9"/></svg>';
  function renderKPIs() {
    var a = M.summarize(v.cur), b = M.summarize(v.prev);
    var spark = M.series(v.cur, v.p.current.start, state.days, v.bucket);
    var fmt = {
      revenue: function (x) { return M.money(x); },
      orders: function (x) { return M.num(x); },
      aov: function (x) { return M.money(x); },
      refundRate: function (x) { return M.percent(x); }
    };
    $$(".kpi").forEach(function (tile) {
      var k = tile.getAttribute("data-k");
      countUp(tile.querySelector(".kpi-v"), a[k], fmt[k]);
      var d = M.delta(a[k], b[k]);
      var out = tile.querySelector(".kpi-d");
      if (d === null) { out.className = "kpi-d"; out.textContent = "Belum ada pembanding"; }
      else {
        var flat = Math.abs(d) < 0.005;
        var good = k === "refundRate" ? d < 0 : d > 0;
        out.className = "kpi-d " + (flat ? "flat" : good ? "good" : "bad");
        out.innerHTML = '<span class="chip">' + (flat ? "" : d > 0 ? UP : DOWN) + (d > 0 ? "+" : "") + M.percent(d) +
          '</span><span class="vs">dari ' + fmt[k](b[k]) + "</span>";
      }
      C.sparkline(tile.querySelector(".kpi-s"), spark.map(function (p) {
        if (k === "orders") return p.orders;
        if (k === "aov") return p.orders ? p.value / p.orders : 0;
        if (k === "refundRate") return p.all ? p.refunds / p.all : 0;
        return p.value;
      }));
    });
  }

  // ---------- tren ----------
  var trendSeen = false;
  function drawTrend(animate) {
    if (!v.p) return;
    var block = $("#trend").closest(".rv");
    if (block && !block.classList.contains("in")) return; // digambar saat terlihat
    var cur = M.series(v.cur, v.p.current.start, state.days, v.bucket);
    var prev = M.series(v.prev, v.p.previous.start, state.days, v.bucket);
    C.line($("#trend"), {
      current: cur, previous: prev, bucket: v.bucket,
      animate: animate || !trendSeen,
      label: "Pendapatan " + rangeText(state.days) + " dibandingkan periode sebelumnya"
    });
    trendSeen = true;
    $("#trendTable").innerHTML = "<thead><tr><th scope=\"col\">" + (v.bucket > 1 ? "Minggu mulai" : "Tanggal") +
      "</th><th scope=\"col\" class=\"r\">Periode ini</th><th scope=\"col\" class=\"r\">Sebelumnya</th></tr></thead><tbody>" +
      cur.map(function (p, i) {
        return "<tr><th scope=\"row\">" + M.date(p.t) + "</th><td class=\"r\">" + M.money(p.value, true) +
          "</td><td class=\"r\">" + M.money(prev[i] ? prev[i].value : 0, true) + "</td></tr>";
      }).join("") + "</tbody>";
  }

  // ---------- buku pesanan ----------
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function when(ms) {
    var d = new Date(ms);
    return '<span class="d">' + M.date(ms, "short") + "</span> " + pad(d.getUTCHours()) + "." + pad(d.getUTCMinutes());
  }
  function tableRows() {
    return M.sortBy(M.filter(v.cur, { status: state.status, query: state.query }), state.sort, state.dir);
  }
  function renderTable(scroll) {
    var pg = M.paginate(tableRows(), state.page, PAGE);
    state.page = pg.page;
    $("#rows").innerHTML = pg.rows.length ? pg.rows.map(function (o) {
      var st = STATUS[o.status];
      return "<tr><td class=\"id\">" + esc(o.id) + "</td><td class=\"mono\">" + when(o.ts) + "</td><td>" + esc(o.city) +
        "</td><td><span class=\"ch\"><i style=\"background:" + COLORS[o.channel] + "\"></i>" + esc(o.channel) +
        "</span></td><td>" + esc(o.category) + "</td><td class=\"r mono\">" + o.items + "</td><td class=\"r mono\">" + M.money(o.total, true) +
        "</td><td><span class=\"st " + st.cls + "\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">" + st.icon + "</svg>" + esc(o.status) + "</span></td></tr>";
    }).join("") : "<tr><td colspan=\"8\" class=\"empty\">Tidak ada pesanan yang cocok. Coba kata lain atau ubah status.</td></tr>";
    $("#pageInfo").innerHTML = "<b>" + pg.page + "</b> / " + pg.pages;
    $("#prev").disabled = pg.page <= 1;
    $("#next").disabled = pg.page >= pg.pages;
    $("#ordersHint").textContent = M.num(pg.total) + " pesanan" + (state.query || state.status !== "all" ? " cocok dengan pencarian" : " dalam " + rangeText(state.days));
    $$(".ledger th").forEach(function (th) {
      var k = th.querySelector("button").getAttribute("data-sort");
      if (k === state.sort) th.setAttribute("aria-sort", state.dir === "asc" ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    });
    if (scroll) {
      var top = $(".ledger-wrap").getBoundingClientRect().top;
      if (top < 60) window.scrollBy({ top: top - 120, behavior: reduce ? "auto" : "smooth" });
    }
  }

  function exportCSV() {
    var blob = new Blob(["﻿" + M.toCSV(tableRows())], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pesanan-senja-" + state.days + "-hari.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
})();
