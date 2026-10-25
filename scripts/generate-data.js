#!/usr/bin/env node
/*
 * Generates docs/data/orders.json: two years of fictional orders for
 * "Senja Roastery", a made-up coffee shop. The generator is seeded, so the
 * output is identical on every run and the demo never changes by accident.
 *
 *   node scripts/generate-data.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "docs", "data", "orders.json");
const END = Date.UTC(2026, 9, 24); // last day in the dataset (2026-10-24)
const DAYS = 730;
const DAY = 86400000;

const channels = ["Organik", "Iklan berbayar", "Media sosial", "Email"];
const categories = ["Biji kopi", "Alat seduh", "Paket hadiah", "Langganan", "Merchandise"];
const cities = ["Jakarta", "Bogor", "Bandung", "Surabaya", "Yogyakarta", "Medan", "Denpasar", "Makassar"];
const statuses = ["Selesai", "Dikirim", "Menunggu", "Dikembalikan"];

// Small deterministic PRNG (mulberry32).
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261024);
function pick(weights) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
}
function poisson(mean) {
  const l = Math.exp(-mean);
  let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > l);
  return k - 1;
}

// Hour of day: quiet at night, peaks at lunch and after work.
const hourWeights = [1, .5, .3, .3, .4, 1, 2, 4, 6, 7, 8, 9, 11, 10, 8, 7, 7, 8, 10, 12, 13, 11, 7, 3];
const priceBase = [165000, 420000, 310000, 240000, 120000];
const cityWeights = [30, 12, 14, 12, 9, 7, 8, 5];

const rows = [];
let seq = 10000;
for (let d = DAYS - 1; d >= 0; d--) {
  const dayMs = END - d * DAY;
  const date = new Date(dayMs);
  const progress = (DAYS - d) / DAYS; // 0 to 1 across the dataset
  const weekday = date.getUTCDay();
  const month = date.getUTCMonth();
  const dom = date.getUTCDate();

  let mean = 5 + progress * 9;                  // steady growth
  if (weekday === 0 || weekday === 6) mean *= 1.25;
  if (month === 11) mean *= 1.3;                // year-end gifting
  if ((month === 10 && dom === 11) || (month === 11 && dom === 12)) mean *= 2.6; // 11.11 and 12.12 sales
  if (dom >= 25 || dom <= 2) mean *= 1.12;      // payday

  const count = poisson(mean);
  for (let i = 0; i < count; i++) {
    const hour = pick(hourWeights);
    const minute = Math.floor(rand() * 60);
    // Paid ads grow over time; email stays small but steady.
    const channel = pick([40 - progress * 8, 18 + progress * 14, 24, 10]);
    const category = pick([42, 16, month === 11 ? 22 : 9, 8 + progress * 10, 9]);
    const city = pick(cityWeights);
    const items = 1 + pick([60, 25, 10, 5]);
    const unit = priceBase[category] * (0.8 + rand() * 0.5);
    const total = Math.round((unit * items) / 500) * 500;
    // Recent orders are more likely still in transit.
    const status = d < 2 ? pick([10, 40, 50, 0]) : d < 6 ? pick([55, 40, 3, 2]) : pick([95, 0, 0, 5]);
    const ts = new Date(dayMs + hour * 3600000 + minute * 60000).toISOString().slice(0, 16);
    rows.push(["SR-" + seq++, ts, channel, category, city, items, total, status]);
  }
}

const data = {
  source: "Data contoh fiktif untuk Senja Roastery, dibuat oleh scripts/generate-data.js. Bukan pesanan sungguhan.",
  currency: "IDR",
  refundStatus: "Dikembalikan",
  end: new Date(END).toISOString().slice(0, 10),
  dict: { channels, categories, cities, statuses },
  columns: ["id", "ts", "channel", "category", "city", "items", "total", "status"],
  rows
};

fs.writeFileSync(OUT, JSON.stringify(data) + "\n");
console.log("wrote " + rows.length + " orders to " + path.relative(process.cwd(), OUT));
