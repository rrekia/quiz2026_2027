// واجهة الفرض الإلكتروني على Netlify — تحفظ النتائج في Netlify Blobs (تخزين دائم ومجاني).
import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";
import cfg from "./questions.mjs";

export const config = { path: ["/api/*", "/export.csv"] };

// توحيد الاسم: يتجاهل الحركات والتطويل واختلاف الألف والياء والتاء المربوطة والمسافات الزائدة
const norm = (s) => String(s ?? "")
  .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
  .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
  .split(/\s+/).filter(Boolean).join(" ").toLowerCase();
// هوية التلميذ = الاسم + القسم فقط (الجهاز غير مهم: عدة تلاميذ يتناوبون على نفس الحاسوب)
const studentKey = (name, group) => hash(norm(name) + "|" + norm(group));
const hash = (s) => createHash("sha256").update(s).digest("hex");
const clean = (s, n) => String(s ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, n);
const TOTAL = 20; // عدد الأسئلة لكل تلميذ

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

function pwOk(given) {
  const real = Buffer.from(String(process.env.ADMIN_PASSWORD || cfg.password || "1234"));
  const g = Buffer.from(String(given ?? ""));
  return g.length === real.length && timingSafeEqual(g, real);
}

const sortRows = (rows) =>
  rows.sort((a, b) => b.score - a.score || a.seconds - b.seconds || a.time.localeCompare(b.time));
const pub = (r) => ({ id: r.id, name: r.name, group: r.group, section: r.section, classGroup: r.classGroup, score: r.score, total: r.total, seconds: r.seconds, time: r.time });

async function allRows(results) {
  const { blobs } = await results.list();
  const rows = await Promise.all(blobs.map((b) => results.get(b.key, { type: "json" })));
  return rows.filter(Boolean);
}

let cache = { t: 0, rows: null };
const invalidate = () => { cache = { t: 0, rows: null }; };

// تهيئة السؤال للإرسال إلى التلميذ دون كشف الإجابة الصحيحة
function shuffled(arr, forbidSame) {
  const a = arr.slice();
  for (let tries = 0; tries < 10; tries++) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    if (!forbidSame || a.some((x, i) => x !== arr[i])) break;
  }
  return a;
}
function publicQ(q, id) {
  const base = { id, q: q.q, cat: q.cat || "other", sub: q.sub || String(id), kind: q.kind || "mc" };
  if (q.type === "order") return { ...base, type: "order", items: shuffled(q.items, true) };
  if (q.type === "match") return { ...base, type: "match", terms: q.pairs.map((p) => p[0]), defs: shuffled(q.pairs.map((p) => p[1]), true) };
  return { ...base, type: "mc", options: q.options, ...(q.image ? { image: q.image } : {}) };
}
const str = (x) => (typeof x === "string" ? x.slice(0, 300) : null);

// تصحيح إجابة واحدة + بناء عنصر المراجعة
function grade(q, ans) {
  const r = grade0(q, ans);
  r.item.cat = q.cat || "other"; r.item.sub = q.sub || ""; r.item.kind = q.kind || "mc";
  return r;
}
function grade0(q, ans) {
  if (q.type === "order") {
    const chosen = Array.isArray(ans) ? ans.map(str) : null;
    const ok = !!chosen && chosen.length === q.items.length && chosen.every((x, i) => x === q.items[i]);
    return { ok, item: { type: "order", q: q.q, items: q.items, chosen, ok } };
  }
  if (q.type === "match") {
    const chosen = Array.isArray(ans) ? ans.map(str) : null;
    const ok = !!chosen && chosen.length === q.pairs.length && q.pairs.every((p, i) => chosen[i] === p[1]);
    return { ok, item: { type: "match", q: q.q, pairs: q.pairs, chosen, ok } };
  }
  const correct = q.options[q.answer];
  const chosen = typeof ans === "string" && q.options.includes(ans) ? ans : null;
  const ok = chosen === correct;
  return { ok, item: { type: "mc", q: q.q, image: q.image || null, options: q.options, correct, chosen, ok } };
}

async function handle(req) {
  const url = new URL(req.url);
  const p = url.pathname;
  const results = getStore({ name: "results", consistency: "strong" });
  const answers = getStore({ name: "answers", consistency: "strong" });

  if (req.method === "GET") {
    if (p === "/api/quiz") {
      return json({
        title: cfg.title || "الفرض الإلكتروني في مادة المعلوماتية",
        quota: cfg.quota || null,
        catNames: cfg.catNames || {},
        questions: cfg.questions.map((q, id) => publicQ(q, id)),
      });
    }
    if (p === "/api/board") {
      if (!cache.rows || Date.now() - cache.t > 3000) {
        cache = { t: Date.now(), rows: sortRows(await allRows(results)).map(pub) };
      }
      return json(cache.rows);
    }
    if (p === "/api/check") {
      const key = studentKey(url.searchParams.get("name"), url.searchParams.get("group"));
      if ((await results.get(key)) !== null) return json({ exists: true, reason: "name" });
      return json({ exists: false });
    }
    if (p === "/api/mine") return json({ row: null });
    if (p === "/export.csv") {
      if (!pwOk(url.searchParams.get("pw"))) return json({ error: "كلمة السر خاطئة" }, 403);
      const rows = sortRows(await allRows(results));
      const esc = (v) => `"${String(v).replaceAll('"', '""')}"`;
      const lines = [["الترتيب", "الاسم", "القسم", "الفوج", "النقطة", "من", "المدة (ثانية)", "الوقت"].map(esc).join(",")];
      rows.forEach((r, i) => lines.push([i + 1, r.name, r.group, r.classGroup || "", r.score, r.total, r.seconds, r.time].map(esc).join(",")));
      return new Response("﻿" + lines.join("\r\n"), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=results.csv", "Cache-Control": "no-store" },
      });
    }
    return json({ error: "not found" }, 404);
  }

  if (req.method === "POST") {
    let body = null;
    try {
      const text = await req.text();
      if (text.length > 65536) throw new Error("big");
      body = JSON.parse(text);
    } catch { /* body stays null */ }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "طلب غير صالح" }, 400);

    if (p === "/api/submit") {
      const name = clean(body.name, 40);
      const group = clean(body.group, 30);
      const classGroup = clean(body.classGroup, 20);
      if (!name) return json({ error: "الاسم مطلوب" }, 400);
      if (!group || !classGroup) return json({ error: "القسم والفوج مطلوبان" }, 400);
      // الواجهة ترسل 20 إجابة: [{id: رقم السؤال في البنك, answer: نص الاختيار أو null}]
      const resp = body.responses;
      if (!Array.isArray(resp) || resp.length !== TOTAL) return json({ error: "إجابات غير صالحة" }, 400);
      const seen = new Set();
      let score = 0;
      const review = []; // مراجعة الإجابات: تُحفظ لتطّلع عليها الأستاذة ويراها التلميذ
      for (const r of resp) {
        const id = r && r.id;
        if (!Number.isInteger(id) || id < 0 || id >= cfg.questions.length || seen.has(id)) return json({ error: "إجابات غير صالحة" }, 400);
        seen.add(id);
        const g = grade(cfg.questions[id], r.answer);
        if (g.ok) score++;
        review.push(g.item);
      }
      let seconds = parseInt(body.seconds, 10);
      if (!Number.isFinite(seconds)) seconds = 0;
      seconds = Math.max(0, Math.min(seconds, 86400));
      const key = studentKey(name, group);
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const row = {
        id: key, name, group, classGroup, score, total: TOTAL, seconds,
        time: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`,
      };
      // حجز الاسم والقسم (ذرّي): إن وُجد سابقًا فلا يُسمح بإعادة الفرض
      const res = await results.setJSON(key, row, { onlyIfNew: true });
      if (!res.modified) return json({ error: "لا يمكنك إعادة الفرض: هذا التلميذ أنجز الفرض من قبل في هذا القسم." }, 409);
      await answers.setJSON(key, { id: key, review });
      invalidate();
      return json({ ok: true, id: key, score, total: row.total, review });
    }

    if (p === "/api/admin/answers") {
      if (!pwOk(body.password)) return json({ error: "كلمة السر خاطئة" }, 403);
      const id = String(body.id ?? "");
      const row = await results.get(id, { type: "json" });
      if (!row) return json({ error: "النتيجة غير موجودة" }, 404);
      const det = await answers.get(id, { type: "json" });
      return json({ row: pub(row), review: det ? det.review : null });
    }

    if (p === "/api/admin/answers-all") {
      if (!pwOk(body.password)) return json({ error: "كلمة السر خاطئة" }, 403);
      const rows = sortRows(await allRows(results));
      const items = await Promise.all(rows.map(async (r) => {
        const det = await answers.get(r.id, { type: "json" });
        return { row: pub(r), review: det ? det.review : null };
      }));
      return json({ items });
    }

    if (p === "/api/admin/delete") {
      if (!pwOk(body.password)) return json({ error: "كلمة السر خاطئة" }, 403);
      const id = String(body.id ?? "");
      await results.delete(id);
      await answers.delete(id);
      invalidate();
      return json({ ok: true });
    }

    if (p === "/api/admin/reset") {
      if (!pwOk(body.password)) return json({ error: "كلمة السر خاطئة" }, 403);
      for (const st of [results, answers]) {
        const { blobs } = await st.list();
        await Promise.all(blobs.map((b) => st.delete(b.key)));
      }
      invalidate();
      return json({ ok: true });
    }
  }

  return json({ error: "not found" }, 404);
}

export default async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error("API error:", e);
    return json({ error: "خطأ في الخادم: " + String(e && e.message ? e.message : e).slice(0, 200) }, 500);
  }
};
