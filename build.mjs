// يُشغَّل تلقائيًا أثناء النشر على Netlify (Build command: node build.mjs)
// يأخذ الملفات المرفوعة في الصفحة الرئيسية ويرتّبها في مجلدين جاهزين للنشر:
//   dist/              ← صفحات الموقع والصور
//   netlify/functions/ ← الخادم (api.mjs) وبنك الأسئلة (questions.mjs)
import { mkdirSync, copyFileSync, rmSync, readdirSync, existsSync } from "node:fs";

const SITE = ["index.html", "admin.html", "processor.jpg", "processor-i5.jpg", "ram.jpg", "keyboard.jpg", "monitor.jpg", "hdd.jpg", "hdd-wd.jpg"];
const FUNCS = ["api.mjs", "questions.mjs"];

for (const f of [...SITE, ...FUNCS]) {
  if (!existsSync(f)) {
    console.error(`❌ الملف المفقود: ${f} — تأكدي أنه مرفوع في الصفحة الرئيسية للمستودع.`);
    process.exit(1);
  }
}

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
mkdirSync("netlify/functions", { recursive: true });

SITE.forEach((f) => copyFileSync(f, `dist/${f}`));
FUNCS.forEach((f) => copyFileSync(f, `netlify/functions/${f}`));

console.log("✅ dist:", readdirSync("dist").join(", "));
console.log("✅ netlify/functions:", readdirSync("netlify/functions").join(", "));
