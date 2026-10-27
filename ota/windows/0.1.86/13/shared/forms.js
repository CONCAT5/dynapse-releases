// 자동 복사: prototypes/hub/src/lib/forms.ts — 수정 금지
// 장의 형태·내용 종류(#119 §3·§4) — 서버가 accepted HTML만 보고 정한다(verify FORM_FN은 화면에서 재고, 여기선 글자로 어림 — 레시피·어드민 주간 줄용).
// 형태: 차트 종류(data-viz type) · 인용 · 비교 · 갤러리 · 사진 전면 · 박스 나열(같은 class 형제 3개 이상) · 과정 · 글만. 내용 종류: 수량·비율·과정·비교·사례·주장·구성·연혁·여정
const VIZ_FORM = { "quote-minimal": "quote", "steps-line": "process", "step-bar": "process", gantt: "timeline", "ratio-sentence": "big-number", "pull-quote": "quote", "before-after": "compare", "grid-gallery": "gallery", "steps-icon": "process", path: "process", "ring-process": "process", flow: "process", timeline: "timeline", "ribbon-timeline": "timeline", "stat-stack": "big-number", "big-number": "big-number" };
const LAYOUT_FORM = { "cover-full": "photo-full", "closing-full": "photo-full", "process-steps": "process", timeline: "timeline", "compare-two": "compare", "quote-voice": "quote", "gallery-grid": "gallery", "split-story": "split", "team-people": "card-grid", "body-series": "box-row", "data-texture": "box-row" };
export function formOf(html) {
    const sec = html.slice(Math.max(0, html.search(/<section\b/i)));
    const vz = sec.match(/\bdata-viz\s*=\s*'([^']*)'/i)?.[1] ?? sec.match(/\bdata-viz\s*=\s*"([^"]*)"/i)?.[1];
    if (vz) {
        const t = vz.replace(/&quot;/g, '"').match(/"type"\s*:\s*"([a-z0-9-]+)"/)?.[1] ?? "?";
        return VIZ_FORM[t] ?? `chart:${t}`;
    }
    {
        const cf = sec.match(/data-block\s*=\s*["']cover_\d+["'][^>]*\bdata-form\s*=\s*["']([a-z-]+)["']/i)?.[1];
        if (cf || /data-block\s*=\s*["']cover_/i.test(sec))
            return cf ?? "cover-colour-giant";
    } // 역할 모양(#119 보정 11)
    {
        const gf = sec.match(/data-block\s*=\s*["']gallery_\d+["'][^>]*\bdata-form\s*=\s*["']([a-z-]+)["']/i)?.[1];
        if (gf)
            return gf;
    } // 사진 장(#119 보정 12)
    for (const k of ["rows", "agenda", "table", "numeral", "collage"])
        if (new RegExp(`data-block\\s*=\\s*["']${k}_`, "i").test(sec))
            return k;
    if (/<table\b/i.test(sec))
        return "table";
    const lay = sec.match(/<section\b[^>]*\bdata-layout\s*=\s*["']([a-z0-9-]+)["']/i)?.[1];
    if (lay && LAYOUT_FORM[lay])
        return LAYOUT_FORM[lay];
    if (/<blockquote\b|data-slot\s*=\s*["'][^"']*quote/i.test(sec))
        return "quote";
    if (/data-block\s*=\s*["']compare_|class\s*=\s*["'][^"']*\bb-side\b/i.test(sec))
        return "compare";
    if ((sec.match(/<img\b/gi) ?? []).length >= 4)
        return "gallery";
    const cls = [...sec.matchAll(/<(?:div|li|article)\b[^>]*\bclass\s*=\s*["']([^"']+)["']/gi)].map(m => m[1].trim());
    const rep = Math.max(0, ...[...new Set(cls)].map(c => cls.filter(x => x === c).length));
    if (/data-block\s*=\s*["'](steps)_|<ol\b/i.test(sec))
        return "process";
    if (rep >= 4)
        return "card-grid";
    if (rep >= 3)
        return "box-row";
    if (/<img\b/i.test(sec))
        return "split";
    return "text-only";
}
export function contentKindOf(html) {
    const t = html.slice(Math.max(0, html.search(/<section\b/i))).replace(/<style\b[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
    const n = (t.match(/\d[\d,.]*\s*(%|만|억|원|명|개|배|곳|건)/g) ?? []).length;
    if (/%|비율|점유|구성비/.test(t) && n)
        return "ratio";
    if (/단계|과정|순서|먼저|절차|step/i.test(t))
        return "process";
    if (/전|후|대비|비교|vs|기존|바꾼/i.test(t))
        return "comparison";
    if (/연혁|년\s|로드맵|history|roadmap/i.test(t))
        return "history";
    if (/여정|고객 경험|journey/i.test(t))
        return "journey";
    if (/사례|고객|후기|인터뷰/.test(t))
        return "case";
    if (n >= 2)
        return "quantity";
    return "claim";
}
// 발주의 장별 형태 조건(#119 보정 2 §3 · spec.forms { "<장 키>": "<형태>" }) — 서버 L0. 글자만 보고 확실한 것만 반려한다:
// 앱이 그리는 형태는 data-viz 그 종류이거나 HTML로 지었되 박스 나열·카드 격자가 아니어야 · table은 <table> · photo-full은 사진. 나머지(rows·collage·numeral·gantt…)는 브리프와 verify variety가 본다
const DRAWN = new Set(["pictogram", "proportion", "ratio", "ring-process", "steps-icon", "before-after", "annotated", "ribbon-timeline", "pull-quote", "stat-stack", "grid-gallery", "path", "big-number", "bar", "line", "area", "donut", "slope", "funnel", "matrix-2x2", "timeline", "flow"]);
// 지정 형태의 장 찾기(#127 보정 7 — 카드뉴스 발주가 forms를 cover·body·data·closing 역할 키로 냈는데 장은 result-card-N이라 "장이 없다"로 늘 반려됐다).
// 서버 L0 · 메시지(앱 seed) · 발주 브리프 · 앱 제출 전 사다리가 같은 표를 쓴다(이 파일은 import 없음 — 앱이 복사해 쓴다).
// 키가 장 키(card-2)·파일(result-card-2.html)·있는 장 이름(result-body.html)이면 그 장. 아니면 역할로: cover·hook = 첫 장, closing·cta = 끝 장(3장 이상),
// 나머지 역할 키는 가운데 장을 차례로(그 형태를 이미 띤 장이 있으면 그 장 먼저). 같은 장을 두 번 쓰지 않는다. 남는 장이 없으면 file null
export function formPages(files, forms, htmlOf) {
    const used = new Set(), out = [];
    const entries = Object.entries(forms ?? {}).map(([k, v]) => ({ key: k, form: String(v ?? "").trim().toLowerCase() })).filter(x => x.form);
    const fileOf = (k) => (/^result-[a-z0-9-]+\.html$/.test(k) ? k : `result-${k.replace(/[^a-z0-9-]/gi, "").toLowerCase()}.html`);
    const left = [];
    for (const e of entries) {
        const f = fileOf(e.key);
        if (files.includes(f) && !used.has(f)) {
            used.add(f);
            out.push({ ...e, file: f });
        }
        else
            left.push(e);
    }
    const roleKey = (k) => k.replace(/^result-|\.html$/g, "").toLowerCase();
    const take = (f) => (f && !used.has(f) ? (used.add(f), f) : null);
    const mid = files.slice(1, files.length >= 3 ? -1 : undefined);
    const shows = (f, form0) => {
        const h = htmlOf?.(f), form = form0.replace(/[^a-z0-9-]/g, "");
        if (!h || !form)
            return false;
        const sec = h.slice(Math.max(0, h.search(/<section\b/i)));
        return new RegExp(`data-form\\s*=\\s*["']${form}["']`, "i").test(sec) || new RegExp(`"type"\\s*:\\s*"${form}"`).test(sec.replace(/&quot;/g, '"')) || formOf(h) === form;
    };
    for (const e of left) {
        const k = roleKey(e.key);
        let f = null;
        if (/^(cover|hook|title)$/.test(k))
            f = take(files[0]);
        else if (/^(closing|close|cta|end|outro|thanks)$/.test(k) && files.length >= 3)
            f = take(files.at(-1));
        else
            f = take(mid.find(x => !used.has(x) && shows(x, e.form))) ?? take(mid.find(x => !used.has(x)));
        out.push({ ...e, file: f });
    }
    return out;
}
export function checkForms(pages, forms) {
    const why = [];
    const by = new Map(pages.map(p => [/\.html$/.test(p.name) ? p.name : `${p.name}.html`, p.html]));
    for (const { key, form, file } of formPages([...by.keys()], forms, f => by.get(f))) {
        const html = file ? by.get(file) : undefined;
        if (!file || html === undefined) {
            why.push(`${key}: 지정 형태(${form})의 장이 없다`);
            continue;
        }
        const sec = html.slice(Math.max(0, html.search(/<section\b/i)));
        const types = [...sec.matchAll(/\bdata-viz\s*=\s*(?:'([^']*)'|"([^"]*)")/gi)].map(m => (m[1] ?? m[2] ?? "").replace(/&quot;/g, '"').match(/"type"\s*:\s*"([a-z0-9-]+)"/)?.[1]).filter(Boolean);
        // 그리는 형태는 data-viz로도, v13 브리프대로 HTML로도 된다 — 그 자리에 박스 나열·카드 격자만 반려(브리프의 "a row of equal boxes in their place is rejected")
        const f0 = formOf(html);
        if (DRAWN.has(form) && !types.includes(form) && (f0 === "box-row" || f0 === "card-grid"))
            why.push(`${key}: 지정 형태 ${form} 자리에 ${f0 === "box-row" ? "박스 나열" : "카드 격자"} — <div class="viz" data-viz='{"type":"${form}",…}'>로 쓰면 앱이 그린다`);
        else if (form === "table" && !/<table\b/i.test(sec))
            why.push(`${key}: 지정 형태 table인데 <table>이 없다`);
        else if (form === "photo-full" && !/<img\b|background(-image)?\s*:\s*url\(/i.test(sec))
            why.push(`${key}: 지정 형태 photo-full인데 사진이 없다`);
    }
    return why;
}
