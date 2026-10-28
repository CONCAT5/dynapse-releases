// 주인공 시트(#304 보정 2 ② — 레퍼런스 7묶음 전부 반복되는 주인공 그림 하나: 핑크 가발 고양이·햄스터…, 장마다 자세·크기만 바뀐다. 디냅스는 0).
// AI가 .dynapse/hero.json {brief}를 쓰고 장에 자리(<figure data-hero="1|2|3|4">)를 두면 → 턴 끝 답에 결정 버튼(#279 보정 1 ④ 결정 칸 — 승인 카드, #304 보정 1 ②)
// → [주인공 그림 만들기] = 사용자 이미지 AI로 같은 캐릭터 네 자세를 글 없이 한 장(2×2) → 앱이 잘라 배경을 빼고(투명 PNG 넷) 자리마다 넣는다(AI 턴 0).
// 덱당 생성 2장 상한(보정 1 ⑥ — 다시 만들기 한 번). 사람 생성 금지(브리프에 사람이면 묻지 않고 건너뜀) · 그림 속 글자 금지. 순수 함수 + 캔버스 자르기(앱 웹뷰의 OffscreenCanvas)
export const HERO_FILE = ".dynapse/hero.json";
export const HERO_CAP = 2, HERO_MAKE = "주인공 그림 만들기", HERO_SKIP = "그림 없이";
const POSES = ["standing and facing the viewer", "waving one hand", "jumping with both arms up", "sitting and smiling"];
// 사람 얼굴·인물 생성 금지(보정 1 ② "사람 생성 금지") — 캐릭터·동물·사물만
export const PERSON = /\b(person|people|man|woman|girl|boy|human|portrait|face of|selfie|idol|model)\b|사람|인물|남자|여자|아이돌|소녀|소년|얼굴/i;
// 사람이 든 브리프인가 — "no people·without humans" 같은 부정은 빼고 본다(C3 S3 2회차 10-27: AI가 지시대로 쓴 "no people, no text" 때문에 고양이 주인공이 사람으로 건너뛰어졌다)
export const personIn = (brief) => PERSON.test(brief.replace(/\b(?:no|without|never|not any)\s+(?:real\s+|human\s+)?(?:people|persons?|humans?|faces?|portraits?|man|men|women|woman)\b/gi, " ").replace(/(?:사람|인물|얼굴)\s*(?:없이|없음|금지|은?\s*빼고)/g, " "));
export function heroPrompt(brief) {
    return [`A character sheet of one recurring mascot: ${brief.trim().slice(0, 400)}.`,
        `Draw the same character four times in a 2×2 grid — top left ${POSES[0]}, top right ${POSES[1]}, bottom left ${POSES[2]}, bottom right ${POSES[3]}.`,
        "Identical design, colours and proportions in all four. Each pose centred in its own quarter with wide empty space around it; nothing crosses the middle lines.",
        "Flat plain pure white background everywhere, no ground shadow, no scenery, no frames, no text, no letters, no numbers, no logos, no watermark. No real people."].join(" ");
}
export function heroDecision(h) {
    return { ask: `덱마다 반복할 주인공 그림을 내 AI로 한 장 만들까요? 같은 캐릭터 네 자세, 글자 없이 · ${h.brief.replace(/\s+/g, " ").slice(0, 90)}`, options: [HERO_MAKE, HERO_SKIP] };
}
// 배경 빼기 — 네 귀퉁이 색의 중앙값을 배경으로, 가장자리에서 이어진 비슷한 색만 투명(캐릭터 안의 흰 부분은 남는다). 경계는 부드럽게(tol~tol×1.7 사이 반투명)
export function keyOut(px, w, h, tol = 40) {
    const at = (x, y) => (y * w + x) * 4, corner = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
    const med = (k) => corner.map(i => px[i + k]).sort((a, b) => a - b)[1], bg = [med(0), med(1), med(2)];
    const dist = (i) => Math.hypot(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]);
    const seen = new Uint8Array(w * h), q = [];
    for (let x = 0; x < w; x++) {
        q.push(x, (h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
        q.push(y * w, y * w + w - 1);
    }
    while (q.length) {
        const p = q.pop();
        if (seen[p])
            continue;
        const i = p * 4, d = dist(i);
        if (d > tol * 1.7)
            continue;
        seen[p] = 1;
        px[i + 3] = d <= tol ? 0 : Math.round(255 * (d - tol) / (tol * 0.7));
        if (d > tol)
            continue; // 경계 화소는 번지지 않는다
        const x = p % w, y = (p / w) | 0;
        if (x > 0)
            q.push(p - 1);
        if (x < w - 1)
            q.push(p + 1);
        if (y > 0)
            q.push(p - w);
        if (y < h - 1)
            q.push(p + w);
    }
}
// 보이는 화소(알파 24 넘음)의 상자. 없으면 null
export function bbox(px, w, h, minA = 24) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
            if (px[(y * w + x) * 4 + 3] > minA) {
                if (x < x0)
                    x0 = x;
                if (x > x1)
                    x1 = x;
                if (y < y0)
                    y0 = y;
                if (y > y1)
                    y1 = y;
            }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
// 시트 한 장 → 네 자세 투명 PNG(사분면마다 배경 빼고 둘레 4% 남겨 자른다). 너무 작게 남은 사분면(전체의 2% 미만)은 실패로 본다
export async function cutSheet(blob) {
    const g0 = globalThis;
    if (typeof g0.createImageBitmap !== "function" || typeof g0.OffscreenCanvas !== "function")
        return null;
    const bmp = await g0.createImageBitmap(blob).catch(() => null);
    if (!bmp)
        return null;
    const qw = Math.floor(bmp.width / 2), qh = Math.floor(bmp.height / 2), out = [];
    for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const cv = new g0.OffscreenCanvas(qw, qh), g = cv.getContext("2d");
        if (!g)
            return null;
        g.drawImage(bmp, cx * qw, cy * qh, qw, qh, 0, 0, qw, qh);
        const im = g.getImageData(0, 0, qw, qh);
        keyOut(im.data, qw, qh);
        const b = bbox(im.data, qw, qh);
        if (!b || b.w * b.h < qw * qh * 0.02)
            return null;
        g.putImageData(im, 0, 0);
        const pad = Math.round(Math.max(b.w, b.h) * 0.04), x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad), w = Math.min(qw - x, b.w + pad * 2), h = Math.min(qh - y, b.h + pad * 2);
        const c2 = new g0.OffscreenCanvas(w, h), g2 = c2.getContext("2d");
        if (!g2)
            return null;
        g2.drawImage(cv, x, y, w, h, 0, 0, w, h);
        out.push(new Uint8Array(await (await c2.convertToBlob({ type: "image/png" })).arrayBuffer()));
    }
    return out;
}
// 장의 주인공 자리(data-hero="1~4")에 잘라 낸 그림 — figure면 안의 img를 바꾸거나 넣고, img면 src만. 크기·자리는 레이아웃·AI가 정한 그대로
export function fillHero(html, files) {
    let n = 0;
    const src = (k) => files[Number(k) - 1];
    let h = html.replace(/<img\b([^>]*\bdata-hero\s*=\s*["']([1-4])["'][^>]*)>/gi, (m, a, k) => { const f = src(k); if (!f)
        return m; n++; return `<img${a.replace(/\s+src\s*=\s*["'][^"']*["']/i, "")} src="${f}">`; });
    h = h.replace(/(<figure\b[^>]*\bdata-hero\s*=\s*["']([1-4])["'][^>]*>)([\s\S]*?)(<\/figure>)/gi, (m, a, k, inner, c) => {
        const f = src(k);
        if (!f)
            return m;
        n++;
        const img = `<img src="${f}" alt="" data-hero-img>`;
        return `${a}${/<img\b/i.test(inner) ? inner.replace(/<img\b[^>]*>/i, img) : img + inner}${c}`;
    });
    return { html: h, n };
}
// 자리가 없는 장에 앱이 스티커 하나(#314 ⑤) — 장 오른쪽 아래, 글 위가 아닌 맨 위 층(누르기는 통과). 이미 넣은 장은 그대로
export function placeHero(html, file, k) {
    if (!file || /\bdata-hero\s*=/.test(html))
        return html;
    const fig = `<figure data-hero="${k}" data-hero-app style="position:absolute;right:40px;bottom:40px;width:150px;height:150px;margin:0;z-index:5;pointer-events:none"><img src="${file}" alt="" data-hero-img style="width:100%;height:100%;object-fit:contain"></figure>`;
    const m = html.match(/<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>/i);
    if (!m)
        return html;
    const at = html.indexOf("</section>", (m.index ?? 0) + m[0].length);
    if (at < 0)
        return html;
    return html.slice(0, at) + fig + html.slice(at);
}
// AI 지시 한 줄(영어) — 반복할 주인공이 있는 덱에서만 쓰게
export const HERO_LINE = `[Recurring character (optional): if the brief has one mascot or character for the whole deck, write .dynapse/hero.json {"brief":"<the character in one English sentence — what it is, colours, outfit; no people, no text>"} once, and put <figure data-hero="1|2|3|4"></figure> where it appears (one per page at most, sticker-sized, never over text). The app asks the user, draws one sheet of four poses with the user's image AI and fills these.]\n`;
