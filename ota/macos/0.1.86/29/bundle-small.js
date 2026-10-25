export const SMALL_FILE = ".dynapse/out/inline-small.json"; // out/ = 작업 git 밖
export const BUNDLE_MAX = 2 * 1024 * 1024 - 64 * 1024; // 앱이 글로 읽는 상한(work_read 2MB)보다 조금 아래
const OWN = /^(materials|context\/assets|\.dynapse\/photos)\/[^"'?#)]+\.(png|jpe?g|webp)$/i;
// 모바일 청첩장 = 표지 1080 q74 · 갤러리 720 q70(진열장 견본 값) · 그 밖 덱 = 긴 변 1600 q78. 같은 사진이 두 곳이면 큰 쪽
export function photoTargets(html) {
    const mobile = /<section\b[^>]*\bdata-format\s*=\s*["']mobile["']/i.test(html), out = new Map();
    const refs = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["'](?:\.\/)?([^"']+)["']/gi), ...html.matchAll(/url\(\s*["']?(?:\.\/)?([^"')]+)["']?\s*\)/gi)];
    for (const m of refs) {
        const f = m[1].trim();
        if (!OWN.test(f))
            continue;
        const slot = [...html.slice(0, m.index).matchAll(/data-slot\s*=\s*["']([a-z0-9_]+)["']/gi)].at(-1)?.[1] ?? "";
        const t = !mobile ? { long: 1600, q: 0.78 } : /cover/.test(slot) || m[0].startsWith("url(") ? { long: 1080, q: 0.74 } : { long: 720, q: 0.7 };
        const prev = out.get(f);
        if (!prev || prev.long < t.long)
            out.set(f, { file: f, ...t });
    }
    return [...out.values()];
}
// 웹뷰 캔버스로 줄이기 — 알파 PNG(로고·누끼)는 그대로(null), 줄여도 원본보다 크면 null
export async function shrinkTo(bytes, name, long, q) {
    const g0 = globalThis;
    if (typeof g0.createImageBitmap !== "function" || typeof g0.OffscreenCanvas !== "function")
        return null;
    const type = /\.png$/i.test(name) ? "image/png" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg";
    const bmp = await g0.createImageBitmap(new Blob([bytes], { type })).catch(() => null);
    if (!bmp)
        return null;
    const k = Math.min(1, long / Math.max(bmp.width, bmp.height)), W = Math.max(1, Math.round(bmp.width * k)), H = Math.max(1, Math.round(bmp.height * k));
    const cv = new g0.OffscreenCanvas(W, H), g = cv.getContext("2d");
    if (!g)
        return null;
    if (type === "image/png") {
        const t = new g0.OffscreenCanvas(64, 64), tg = t.getContext("2d");
        if (!tg)
            return null;
        tg.drawImage(bmp, 0, 0, 64, 64);
        const d = tg.getImageData(0, 0, 64, 64).data;
        for (let i = 3; i < d.length; i += 4)
            if (d[i] < 250)
                return null;
    }
    g.fillStyle = "#FFFFFF";
    g.fillRect(0, 0, W, H);
    g.drawImage(bmp, 0, 0, W, H);
    const blob = await cv.convertToBlob({ type: "image/jpeg", quality: q }).catch(() => null);
    if (!blob || blob.size >= bytes.length)
        return null;
    const b = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000)
        s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return `data:image/jpeg;base64,${btoa(s)}`;
}
let shrinkImpl = null;
export const setShrink = (f) => { shrinkImpl = f; };
export const shrinker = () => shrinkImpl ?? shrinkTo;
// 장들의 사진 → 작은 판 지도. 같은 파일·크기·목표면 지난 값 그대로(검사마다 다시 줄이지 않는다)
export async function smallPhotos(d) {
    const want = new Map();
    for (const p of d.pages) {
        const h = await d.read(p).catch(() => null);
        if (h)
            for (const t of photoTargets(h)) {
                const o = want.get(t.file);
                if (!o || o.long < t.long)
                    want.set(t.file, t);
            }
    }
    if (!want.size)
        return { n: 0, saved: 0 };
    const sz = await d.sizes().catch(() => ({})), out = {};
    let n = 0, saved = 0;
    for (const t of want.values()) {
        const size = sz[t.file];
        if (!size || size < 120 * 1024)
            continue; // 작은 사진은 그대로
        const key = `${t.long}|${t.q}`, old = d.prev?.[t.file];
        if (old && old.size === size && old.key === key) {
            out[t.file] = old;
            continue;
        }
        const b = await d.bytes(t.file).catch(() => null);
        if (!b)
            continue;
        const url = await d.shrink(b, t.file, t.long, t.q).catch(() => null);
        if (!url)
            continue;
        out[t.file] = { size, url, key };
        n++;
        saved += size - Math.round(url.length * 0.75);
    }
    await d.write(JSON.stringify(out));
    return { n, saved };
}
// 서버 L0의 빈 업로드 사유(#281) — 토큰 다시 만들기·글자 칸 사다리를 타지 않는다
export const EMPTY_WHY = /올라온 장이 비어 있다|<section class="slide">가 없다|data-slot 칸이 없다\(빈 장\)/;
