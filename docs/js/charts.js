/*
 * Dasbor Toko, lapisan gambar.
 * Grafik SVG dan HTML kecil tanpa pustaka. Setiap fungsi mengosongkan wadahnya
 * lalu menggambar ulang, jadi bisa dipanggil lagi saat filter atau ukuran berubah.
 * MIT License, Reza Arya Maulana.
 */
(function (root) {
  "use strict";

  var M = root.DasborMetrics;
  var NS = "http://www.w3.org/2000/svg";
  var reduce = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function svg(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function el(tag, cls, parent, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /** Membulatkan batas atas sumbu ke angka yang enak dibaca. */
  function niceTicks(max, count) {
    if (max <= 0) return [0, 1];
    var raw = max / count;
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * pow; }).filter(function (s) { return s >= raw; })[0];
    var ticks = [];
    for (var v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  // ---------- tooltip, satu untuk seluruh halaman ----------
  var tip;
  function showTip(html, x, y) {
    if (!tip) {
      tip = el("div", "tip", document.body);
      tip.setAttribute("role", "status");
    }
    tip.innerHTML = html;
    tip.classList.add("on");
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var vw = document.documentElement.clientWidth;
    var left = Math.min(Math.max(10, x - w / 2), vw - w - 10);
    var top = y - h - 14;
    if (top < 10) top = y + 20;
    tip.style.transform = "translate3d(" + Math.round(left) + "px," + Math.round(top + window.scrollY) + "px,0)";
  }
  function hideTip() { if (tip) tip.classList.remove("on"); }

  // Jari "keluar" begitu diangkat, jadi di layar sentuh tooltip bertahan
  // sampai pengguna mengetuk tempat lain.
  var touchOwner = null;
  document.addEventListener("pointerdown", function (ev) {
    if (touchOwner && !touchOwner.contains(ev.target)) { touchOwner.dispatchEvent(new Event("tipclear")); touchOwner = null; }
  });

  // ---------- grafik garis: periode ini vs sebelumnya ----------
  /**
   * opts: { current, previous, bucket, label, animate }
   * current/previous: [{ t, value }]
   */
  function line(host, opts) {
    host.innerHTML = "";
    var W = Math.max(280, Math.round(host.clientWidth)), narrow = W < 560;
    var H = narrow ? 240 : 320;
    var m = { t: 28, r: narrow ? 8 : 16, b: 30, l: narrow ? 40 : 52 };
    var cur = opts.current, prev = opts.previous || [], n = cur.length;
    var max = 0;
    cur.concat(prev).forEach(function (p) { if (p.value > max) max = p.value; });
    var ticks = niceTicks(max, 4), top = ticks[ticks.length - 1];
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var x = function (i) { return m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw); };
    var y = function (v) { return m.t + (1 - v / top) * ih; };
    var axisMoney = function (v) { return v === 0 ? "0" : M.money(v).replace("Rp ", ""); };

    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, class: "line-svg", role: "img", "aria-label": opts.label });

    var g = svg("g", { class: "grid" }, s);
    ticks.forEach(function (v) {
      svg("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? "base" : "" }, g);
      svg("text", { x: m.l - 10, y: y(v) + 4, "text-anchor": "end", class: "axis" }, g).textContent = axisMoney(v);
    });
    var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / (narrow ? 84 : 104)))));
    for (var i = 0; i < n; i += every) {
      svg("text", { x: x(i), y: H - 8, "text-anchor": i === 0 ? "start" : "middle", class: "axis" }, g).textContent = M.date(cur[i].t, "short");
    }

    function path(points) {
      var d = "";
      for (var i = 0; i < Math.min(points.length, n); i++) d += (i ? "L" : "M") + x(i).toFixed(1) + " " + y(points[i].value).toFixed(1);
      return d;
    }
    if (prev.length) svg("path", { d: path(prev), class: "ln prev" }, s);
    var area = svg("path", { d: path(cur) + "L" + x(n - 1).toFixed(1) + " " + y(0) + "L" + x(0).toFixed(1) + " " + y(0) + "Z", class: "area" }, s);
    var curPath = svg("path", { d: path(cur), class: "ln cur" }, s);

    // Anotasi titik tertinggi, karena itu yang pertama ditanyakan orang.
    var bi = 0;
    cur.forEach(function (p, i) { if (p.value > cur[bi].value) bi = i; });
    if (cur[bi].value > 0) {
      var ax = x(bi), ay = y(cur[bi].value);
      var note = svg("g", { class: "note" }, s);
      svg("circle", { cx: ax, cy: ay, r: 4.5, class: "note-dot" }, note);
      var right = ax < W * 0.62;
      var tx = svg("text", { x: ax + (right ? 10 : -10), y: Math.max(14, ay - 10), "text-anchor": right ? "start" : "end", class: "note-t" }, note);
      tx.textContent = "Tertinggi " + M.money(cur[bi].value);
    }

    // lapisan sentuh dan arah
    var hair = svg("line", { y1: m.t, y2: H - m.b, class: "hair" }, s);
    var dotPrev = svg("circle", { r: 4, class: "dot prev" }, s);
    var dotCur = svg("circle", { r: 5, class: "dot cur" }, s);
    var hit = svg("rect", { x: m.l, y: 0, width: iw, height: H, class: "hit" }, s);
    function hide() { hair.style.display = dotCur.style.display = dotPrev.style.display = "none"; hideTip(); }
    hide();

    function move(ev) {
      var r = s.getBoundingClientRect();
      var px = (ev.clientX - r.left) * (W / r.width);
      var i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
      var c = cur[i], p = prev[i];
      hair.setAttribute("x1", x(i)); hair.setAttribute("x2", x(i));
      dotCur.setAttribute("cx", x(i)); dotCur.setAttribute("cy", y(c.value));
      hair.style.display = dotCur.style.display = "";
      if (p) { dotPrev.setAttribute("cx", x(i)); dotPrev.setAttribute("cy", y(p.value)); dotPrev.style.display = ""; }
      var head = opts.bucket > 1 ? "Minggu " + M.date(c.t) : M.date(c.t, "long");
      var html = '<div class="tip-h">' + head + "</div>" +
        '<div class="tip-r"><i class="key cur"></i>Periode ini<b>' + M.money(c.value, true) + "</b></div>";
      if (p) html += '<div class="tip-r"><i class="key prev"></i>Sebelumnya<b>' + M.money(p.value, true) + "</b></div>";
      html += '<div class="tip-f">' + c.orders + " pesanan</div>";
      showTip(html, r.left + x(i) * (r.width / W), r.top + y(c.value) * (r.height / H));
      if (ev.pointerType === "touch") touchOwner = s;
    }
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", function (ev) { if (ev.pointerType !== "touch") hide(); });
    s.addEventListener("tipclear", hide);
    host.appendChild(s);

    // Garis "ditulis" dari kiri ke kanan.
    if (opts.animate && !reduce) {
      var len = curPath.getTotalLength();
      curPath.style.strokeDasharray = len;
      curPath.style.strokeDashoffset = len;
      area.style.opacity = 0;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          curPath.style.transition = "stroke-dashoffset 1.4s cubic-bezier(.65,0,.35,1)";
          curPath.style.strokeDashoffset = 0;
          area.style.transition = "opacity .8s ease .6s";
          area.style.opacity = "";
        });
      });
    }
  }

  // ---------- batang horizontal ----------
  /** rows: [{ key, value, share }], opts: { colors, active, rank } */
  function bars(host, rows, opts) {
    opts = opts || {};
    host.innerHTML = "";
    var max = rows.reduce(function (a, r) { return Math.max(a, r.value); }, 0) || 1;
    var list = el("ol", "bars", host);
    rows.forEach(function (r, i) {
      var li = el("li", "bar" + (opts.active && opts.active !== r.key ? " dim" : "") + (opts.active === r.key ? " on" : ""), list);
      li.style.setProperty("--i", i);
      li.setAttribute("data-key", r.key);
      var head = el("div", "bar-h", li);
      if (opts.rank) el("span", "bar-n", head, pad(i + 1));
      else if (opts.colors) el("i", "bar-sw", head).style.background = opts.colors[r.key];
      el("span", "bar-k", head, r.key);
      el("span", "bar-v", head, M.money(r.value));
      el("span", "bar-p", head, M.percent(r.share));
      var track = el("div", "bar-t", li);
      var fill = el("div", "bar-f", track);
      fill.style.setProperty("--w", Math.max(1.2, (r.value / max) * 100) + "%");
      fill.style.background = (opts.colors && opts.colors[r.key]) || "var(--ink)";
    });
  }

  // ---------- peta panas: hari x jam ----------
  var HARI3 = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
  function heatmap(host, hm) {
    host.innerHTML = "";
    var wrap = el("div", "heat", host);
    wrap.style.gridTemplateColumns = "38px repeat(" + hm.cols + ", minmax(0, 1fr))";
    el("span", "", wrap);
    for (var c = 0; c < hm.cols; c++) el("span", "heat-x", wrap, pad(c * hm.hoursPerCell));
    hm.grid.forEach(function (row, r) {
      el("span", "heat-y", wrap, HARI3[r]);
      row.forEach(function (v, c) {
        var cell = el("span", "heat-c", wrap);
        var step = hm.max ? Math.min(6, Math.floor((v / hm.max) * 7)) : 0;
        cell.style.background = "var(--seq-" + step + ")";
        cell.style.setProperty("--d", (r * hm.cols + c) * 9 + "ms");
        var from = c * hm.hoursPerCell;
        var label = M.HARI[r] + ", " + pad(from) + ".00 sampai " + pad((from + hm.hoursPerCell) % 24) + ".00";
        if (hm.peak && hm.peak.day === r && hm.peak.col === c) cell.classList.add("peak");
        cell.setAttribute("aria-label", label + ": " + v + " pesanan");
        cell.tabIndex = -1;
        function show() {
          var b = cell.getBoundingClientRect();
          showTip('<div class="tip-h">' + label + '</div><div class="tip-r">Pesanan<b>' + v + "</b></div>", b.left + b.width / 2, b.top);
          touchOwner = wrap;
        }
        cell.addEventListener("pointerenter", show);
        cell.addEventListener("pointerdown", show);
        cell.addEventListener("pointerleave", function (ev) { if (ev.pointerType !== "touch") hideTip(); });
      });
    });
    wrap.addEventListener("tipclear", hideTip);
    var legend = el("div", "heat-l", host);
    el("span", "", legend, "Sepi");
    for (var i = 0; i < 7; i++) el("i", "", legend).style.background = "var(--seq-" + i + ")";
    el("span", "", legend, "Ramai");
  }

  // ---------- garis kecil di kartu angka ----------
  function sparkline(host, values) {
    host.innerHTML = "";
    if (!values.length) return;
    var W = 160, H = 36, max = Math.max.apply(null, values), min = Math.min.apply(null, values), span = max - min || 1;
    var pts = values.map(function (v, i) {
      return [(i / Math.max(1, values.length - 1)) * W, H - 4 - ((v - min) / span) * (H - 8)];
    });
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join("");
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", class: "spark", "aria-hidden": "true" });
    svg("path", { d: d, "vector-effect": "non-scaling-stroke" }, s);
    var last = pts[pts.length - 1];
    host.appendChild(s);
    var dot = el("i", "spark-dot", host);
    dot.style.left = (last[0] / W) * 100 + "%";
    dot.style.top = (last[1] / H) * 100 + "%";
  }

  root.DasborCharts = { line: line, bars: bars, heatmap: heatmap, sparkline: sparkline, niceTicks: niceTicks, hideTip: hideTip };
})(typeof self !== "undefined" ? self : this);
