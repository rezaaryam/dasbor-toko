"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const M = require("../docs/js/metrics.js");

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "data", "orders.json"), "utf8"));
const all = M.decode(raw);

function order(over) {
  return Object.assign({
    id: "SR-1", ts: M.utc("2026-10-01T10:00"), hour: 10, weekday: 3, channel: "Organik", category: "Biji kopi",
    city: "Bogor", items: 1, total: 100000, status: "Selesai", refund: false
  }, over);
}

test("data contoh punya bentuk yang diharapkan", () => {
  assert.deepEqual(raw.columns, ["id", "ts", "channel", "category", "city", "items", "total", "status"]);
  assert.ok(raw.dict.statuses.includes(raw.refundStatus));
  assert.ok(raw.rows.length > 5000);
  for (const o of all.slice(0, 500)) {
    assert.match(o.id, /^SR-\d+$/);
    assert.ok(o.total > 0 && Number.isInteger(o.items));
    assert.equal(o.refund, o.status === raw.refundStatus);
  }
});

test("data mencakup dua tahun penuh yang berakhir di raw.end", () => {
  const ts = all.map(o => o.ts);
  const first = Math.min(...ts), last = Math.max(...ts);
  assert.equal(M.dayKey(last), raw.end);
  assert.ok((last - first) / M.DAY > 700);
});

test("utc tidak terpengaruh zona waktu lokal", () => {
  assert.equal(M.utc("2026-10-24"), Date.UTC(2026, 9, 24));
  assert.equal(M.utc("2026-10-24T13:05"), Date.UTC(2026, 9, 24, 13, 5));
});

test("decode memakai Senin sebagai hari ke-0", () => {
  const [o] = M.decode({ columns: raw.columns, dict: raw.dict, refundStatus: raw.refundStatus, rows: [["SR-1", "2026-10-19T09:30", 0, 0, 0, 1, 1000, 3]] });
  assert.equal(o.weekday, 0); // 19 Okt 2026 jatuh pada Senin
  assert.equal(o.hour, 9);
  assert.equal(o.refund, true);
});

test("periode berurutan dan sama panjang", () => {
  const p = M.periods("2026-10-24", 30);
  assert.equal(M.dayKey(p.current.start), "2026-09-25");
  assert.equal(p.previous.end + 1, p.current.start);
  assert.equal(p.current.end - p.current.start, p.previous.end - p.previous.start);
});

test("filter menggabungkan rentang, kanal, status, dan pencarian", () => {
  const list = [order({ id: "SR-1" }), order({ id: "SR-2", channel: "Email" }), order({ id: "SR-3", status: "Dikembalikan", refund: true, city: "Medan" })];
  assert.equal(M.filter(list, { channel: "Email" }).length, 1);
  assert.equal(M.filter(list, { status: "Dikembalikan" }).length, 1);
  assert.equal(M.filter(list, { query: "  medan " }).length, 1);
  assert.equal(M.filter(list, { channel: "all", status: "all" }).length, 3);
  assert.equal(M.filter(list, { start: M.utc("2026-10-02") }).length, 0);
});

test("refund tidak masuk pendapatan tetapi dihitung di tingkat refund", () => {
  const s = M.summarize([order({ total: 200000 }), order({ total: 100000 }), order({ total: 999000, refund: true }), order({ total: 300000 })]);
  assert.equal(s.revenue, 600000);
  assert.equal(s.orders, 3);
  assert.equal(s.aov, 200000);
  assert.equal(s.refundRate, 0.25);
  assert.deepEqual(M.summarize([]), { revenue: 0, orders: 0, aov: 0, items: 0, refundRate: 0 });
});

test("delta menangani naik, turun, dan pembanding kosong", () => {
  assert.equal(M.delta(120, 100), 0.2);
  assert.equal(M.delta(50, 100), -0.5);
  assert.equal(M.delta(10, 0), null);
});

test("deret waktu mengisi hari kosong dengan nol dan bisa mingguan", () => {
  const start = M.utc("2026-10-01");
  const list = [order({ ts: M.utc("2026-10-01T08:00") }), order({ ts: M.utc("2026-10-03T08:00"), total: 50000 }), order({ ts: M.utc("2026-10-09T08:00") }), order({ ts: M.utc("2026-10-09T09:00"), refund: true })];
  const daily = M.series(list, start, 10, 1);
  assert.equal(daily.length, 10);
  assert.deepEqual(daily.slice(0, 3).map(p => p.value), [100000, 0, 50000]);
  assert.deepEqual(M.series(list, start, 10, 7).map(p => p.value), [150000, 100000]);
  assert.equal(daily[8].refunds, 1);
  assert.equal(daily[8].all, 2);
});

test("jumlah deret sama dengan ringkasan untuk jendela yang sama", () => {
  const p = M.periods(raw.end, 90).current;
  const cur = M.filter(all, p);
  assert.equal(M.series(cur, p.start, 90, 7).reduce((a, b) => a + b.value, 0), M.summarize(cur).revenue);
});

test("groupSum urut dari terbesar dan porsinya berjumlah 1", () => {
  const g = M.groupSum(all, "channel");
  for (let i = 1; i < g.length; i++) assert.ok(g[i - 1].value >= g[i].value);
  assert.ok(Math.abs(g.reduce((a, b) => a + b.share, 0) - 1) < 1e-9);
});

test("peta panas menghitung setiap pesanan non-refund satu kali dan menandai puncak", () => {
  const p = M.periods(raw.end, 30).current;
  const cur = M.filter(all, p);
  const hm = M.heatmap(cur, 3);
  assert.equal(hm.grid.length, 7);
  assert.equal(hm.cols, 8);
  assert.equal(hm.grid.flat().reduce((a, b) => a + b, 0), M.summarize(cur).orders);
  assert.equal(hm.grid[hm.peak.day][hm.peak.col], hm.max);
});

test("insights memilih kanal terbesar dan hari terbaik", () => {
  const p = M.periods(raw.end, 30);
  const cur = M.filter(all, p.current), prev = M.filter(all, p.previous);
  const ins = M.insights(cur, prev, p.current.start, 30);
  assert.equal(ins.topChannel.key, M.groupSum(cur, "channel")[0].key);
  assert.equal(ins.revenue, M.summarize(cur).revenue);
  const best = Math.max(...M.series(cur, p.current.start, 30, 1).map(s => s.value));
  assert.equal(ins.bestDay.value, best);
  assert.ok(M.HARI.includes(ins.peakSlot.day));
});

test("sortBy stabil dan paginate membatasi halaman", () => {
  const list = [{ k: 2, n: "a" }, { k: 1, n: "b" }, { k: 2, n: "c" }];
  assert.deepEqual(M.sortBy(list, "k", "desc").map(x => x.n), ["a", "c", "b"]);
  assert.deepEqual(M.sortBy(list, "k", "asc").map(x => x.n), ["b", "a", "c"]);
  assert.deepEqual(M.paginate([1, 2, 3, 4, 5], 9, 2), { rows: [5], page: 3, pages: 3, total: 5 });
  assert.equal(M.paginate([], 1, 10).pages, 1);
});

test("format uang, angka, persen, dan tanggal gaya Indonesia", () => {
  assert.equal(M.money(177250000), "Rp 177 jt");
  assert.equal(M.money(56700000), "Rp 56,7 jt");
  assert.equal(M.money(400000), "Rp 400 rb");
  assert.equal(M.money(1250000000), "Rp 1,3 M");
  assert.equal(M.money(6157000, true), "Rp 6.157.000");
  assert.equal(M.num(-12345), "-12.345");
  assert.equal(M.percent(0.083), "8,3%");
  assert.equal(M.percent(0.1), "10%");
  assert.equal(M.date(M.utc("2026-10-24"), "long"), "24 Oktober 2026");
  assert.equal(M.date(M.utc("2026-08-05"), "short"), "5 Agu");
});

test("toCSV meloloskan koma dan tanda kutip", () => {
  const csv = M.toCSV([order({ city: 'Bogor, "Kota"' })]);
  assert.match(csv.trim().split("\n")[1], /"Bogor, ""Kota"""/);
  assert.ok(csv.startsWith("id,tanggal,kanal"));
});
