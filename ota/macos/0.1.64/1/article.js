// 글 주소 → 원고(#83 §1) — 사용자가 붙인 주소 1개만 앱이 가져와 본문·제목·날짜·대표 이미지를 뽑는다. AI 턴 전, 토큰 0.
// 가져오기 = OS curl(GET·http(s)·포트 80/443만 · 리다이렉트는 앱이 홉마다 IP 검사 뒤 최대 3 · 15초 · 5MB) · 뽑기 = 웹뷰의 DOMParser(readability 축약: 문단 점수가 가장 큰 블록).
// 결과 context/refs/url-<slug>.md(머리에 title·url·date·image) + 대표 이미지 context/assets/url-<slug>.<ext>(사용자 글의 사진 = 내 사진 후보)
import { T, exec } from "./main.js";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Dynapse/1.0";
const wput = (id, file, text) => T().core.invoke("work_write", { id, file, text });
const wread = (id, file) => T().core.invoke("work_read", { id, file }).catch(() => null);
// 사설·로컬 주소는 가져오지 않는다(이름 확인 뒤 사설 IP로 가는 경우는 curl이 막지 못하지만, 사용자가 자기 PC에서 자기가 붙인 주소만)
const privateHost = (h) => /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|\[?::1\]?)$/i.test(h)
    || /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || /^\[?f[cd]/i.test(h);
// 네이버 블로그는 본문이 mainFrame(PostView) 안에 있다
function rewrite(u) {
    const h = u.hostname.replace(/^m\./, "");
    if (h === "blog.naver.com") {
        const m = u.pathname.match(/^\/([A-Za-z0-9_-]+)\/(\d+)/);
        if (m)
            return new URL(`https://blog.naver.com/PostView.naver?blogId=${m[1]}&logNo=${m[2]}`);
        const id = u.searchParams.get("blogId"), no = u.searchParams.get("logNo");
        if (id && no)
            return new URL(`https://blog.naver.com/PostView.naver?blogId=${id}&logNo=${no}`);
    }
    return u;
}
// 가져오기 안전장치(#88 A-1·A-5) — 리다이렉트를 curl에 맡기지 않는다. 홉마다(최대 3) ① http(s)·포트 80/443만 ② 이름을 IP로 먼저 풀어(resolve_host)
// 사설·루프백·링크로컬·메타데이터·CGNAT·멀티캐스트 대역이면 거부 ③ curl은 --resolve로 그 IP에만 붙는다(DNS 재바인딩·302→localhost 차단).
// URL 파서가 2130706433·127.1·0x7f000001을 127.0.0.1로, [::ffff:127.0.0.1]을 [::ffff:7f00:1]로 바꿔 준 뒤에 검사한다
function blockedIp(ip0) {
    let s = ip0.replace(/^\[|\]$/g, "").toLowerCase();
    const hx = s.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hx) {
        const a = parseInt(hx[1], 16), b = parseInt(hx[2], 16);
        s = `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
    }
    const dm = s.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
    if (dm)
        s = dm[1];
    const v4 = s.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (v4) {
        const [a, b] = [Number(v4[1]), Number(v4[2])];
        return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19));
    }
    if (!s.includes(":"))
        return true; // IP가 아니면 막는다
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || /^::ffff:/.test(s) || /^64:ff9b:/.test(s);
}
async function pin(u) {
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || privateHost(u.hostname))
        return null;
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    if (port !== 80 && port !== 443)
        return null;
    const host = u.hostname.replace(/^\[|\]$/g, "");
    const literal = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
    let native = true;
    const ips = literal ? [host] : await T().core.invoke("resolve_host", { host, port }).catch(e => { native = !/not found|unknown command|not allowed/i.test(String(e)); return []; });
    if (!native)
        return ""; // 0.1.62 이하(풀기 명령 없음) — 고정 없이, 받은 뒤 실제로 붙은 IP(remote_ip)를 본다
    if (!ips.length || ips.some(blockedIp))
        return null; // 하나라도 사설이면(섞어 둔 응답) 거부
    const ip = ips.find(x => !x.includes(":")) ?? ips[0];
    return `${host}:${port}:${ip.includes(":") ? `[${ip}]` : ip}`;
}
// 한 번 받기 — 홉마다 pin. 반환 = 본문(stdout, -o면 빈 값) + 끝 홉의 코드 + 추가 -w 값들
async function safeCurl(url, extra, wmore = []) {
    let cur = url;
    for (let hop = 0; hop <= 3; hop++) {
        let u;
        try {
            u = new URL(cur);
        }
        catch {
            return null;
        }
        const res = await pin(u);
        if (res === null)
            return null;
        const r = await exec("curl", ["-sS", "--max-redirs", "0", "--max-time", "15", "--proto", "=http,https", ...(res ? ["--resolve", res] : []), "-A", UA, "-H", "accept-language: ko,en;q=0.8", ...extra, "-w", `\n%{http_code}\t%{redirect_url}\t%{remote_ip}${wmore.map(x => `\t${x}`).join("")}`, u.href]).catch(() => null);
        if (!r || r.code !== 0)
            return null;
        const i = r.stdout.lastIndexOf("\n"), tail0 = r.stdout.slice(i + 1).split("\t"), code = Number(tail0[0]);
        if (!res && (!tail0[2] || blockedIp(tail0[2])))
            return null; // 고정 못 한 경우 — 사설 IP에서 온 답은 버린다
        const tail = [tail0[0], tail0[1], ...tail0.slice(3)];
        if (code >= 300 && code < 400 && tail[1]) {
            cur = new URL(tail[1], u.href).href;
            continue;
        }
        return { body: r.stdout.slice(0, i), code, w: tail.slice(2) };
    }
    return null;
}
const MAX_PAGE = 5_000_000, MAX_IMG = 8_000_000;
// 이미지 하나 — .dynapse/tmp로 받아 이미지 형식·크기(실제 받은 바이트)를 본 뒤에만 자리로. 실패·초과면 null(내 사진 자리에 남기지 않는다)
async function getImage(dir, url, tmpName, relBase, referer, kinds) {
    const hdr = referer ? ["-H", `referer: ${referer}`] : [];
    const probe = await safeCurl(url, ["--fail", "--max-filesize", String(MAX_IMG), ...hdr, "--create-dirs", "-o", `${dir}/.dynapse/tmp/${tmpName}`], ["%{content_type}", "%{size_download}"]);
    if (!probe || probe.code !== 200)
        return null;
    const [type, size] = probe.w;
    if (!kinds.test(type ?? "") || Number(size) < 2000 || Number(size) > MAX_IMG)
        return null;
    const ext = /png/.test(type) ? "png" : /webp/.test(type) ? "webp" : /gif/.test(type) ? "gif" : "jpg", rel = `${relBase}.${ext}`;
    const got = await safeCurl(url, ["--fail", "--max-filesize", String(MAX_IMG), ...hdr, "--create-dirs", "-o", `${dir}/${rel}`], ["%{size_download}"]);
    return got && got.code === 200 && Number(got.w[0]) <= MAX_IMG ? rel : null;
}
const slugOf = async (u) => {
    const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(u));
    const hex = [...new Uint8Array(d)].slice(0, 4).map(b => b.toString(16).padStart(2, "0")).join("");
    return `${new URL(u).hostname.replace(/^www\.|^m\./, "").split(".")[0].replace(/[^a-z0-9-]/gi, "") || "web"}-${hex}`;
};
// ── HTML → 글 ──
const BLOCK = /^(P|DIV|SECTION|ARTICLE|LI|UL|OL|BLOCKQUOTE|TR|TABLE|FIGURE|H[1-6]|PRE)$/;
function toText(el, imgs = []) {
    let out = "";
    const walk = (n) => {
        if (n.nodeType === 3) {
            out += (n.textContent ?? "").replace(/\s+/g, " ");
            return;
        }
        if (n.nodeType !== 1)
            return;
        const e = n, tag = e.tagName;
        if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|IFRAME|FORM|BUTTON|SELECT|NAV|FOOTER|ASIDE)$/.test(tag))
            return;
        if (/^H[1-4]$/.test(tag)) {
            const t = (e.textContent ?? "").replace(/\s+/g, " ").trim();
            if (t)
                out += `\n\n## ${t}\n\n`;
            return;
        }
        // 본문 사진 — 순서대로 번호(앱이 받아 context/assets/url-<slug>-<n>로 둔다). 네이버는 data-lazy-src가 원본(src는 흐린 미리보기)
        // srcset·<picture>는 가장 큰 것(HTML에서 받는 원본에 가깝게)
        if (tag === "IMG") {
            const big = (ss) => (ss ?? "").split(",").map(x => x.trim().split(/\s+/)).filter(x => x[0]).sort((a, b) => parseFloat(b[1] ?? "0") - parseFloat(a[1] ?? "0"))[0]?.[0] ?? "";
            const src = e.getAttribute("data-lazy-src") || big(e.getAttribute("srcset") || e.parentElement?.querySelector("source")?.getAttribute("srcset") || null) || e.getAttribute("data-src") || e.getAttribute("data-original") || e.getAttribute("src") || "";
            const w = Number(e.getAttribute("width") || 0);
            if (/^https?:\/\//.test(src) && !/sticker|emoticon|icon|blank\.gif|spacer/i.test(src) && (!w || w >= 120)) {
                imgs.push(src);
                out += `\n[사진 ${imgs.length}]\n`;
            }
            else
                out += "\n[사진]\n";
            return;
        }
        if (tag === "BR") {
            out += "\n";
            return;
        }
        if (tag === "LI")
            out += "\n- ";
        for (const c of Array.from(e.childNodes))
            walk(c);
        if (BLOCK.test(tag))
            out += "\n";
    };
    walk(el);
    return out.replace(/[ \t ​]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").replace(/(\[사진\]\n+){2,}/g, "[사진]\n\n").trim();
}
const textLen = (e) => (e.textContent ?? "").replace(/\s+/g, "").length;
const linkDensity = (e) => { const t = textLen(e) || 1; let l = 0; for (const a of Array.from(e.querySelectorAll("a")))
    l += textLen(a); return l / t; };
const KNOWN = [".se-main-container", "#postViewArea", ".wrap_body", ".tt_article_useless_p_margin", ".entry-content", ".article-content", ".post-content", ".article_body", "[itemprop=articleBody]", "#articleBodyContents", ".news_end"];
function bodyOf(doc, imgs = []) {
    for (const q of KNOWN) {
        const e = doc.querySelector(q);
        if (e && textLen(e) >= 200)
            return toText(e, imgs);
    }
    // 문단 점수 — 글 문단이 몰린 부모가 본문(링크 많은 블록은 깎는다)
    const score = new Map();
    for (const p of Array.from(doc.querySelectorAll("p, pre, td, .se-text-paragraph"))) {
        const len = textLen(p);
        if (len < 25)
            continue;
        const s = 1 + ((p.textContent ?? "").match(/[,，、.。]/g)?.length ?? 0) * 0.3 + Math.min(len / 100, 3);
        const a = p.parentElement, b = a?.parentElement;
        if (a)
            score.set(a, (score.get(a) ?? 0) + s);
        if (b)
            score.set(b, (score.get(b) ?? 0) + s / 2);
    }
    let best = null, bs = 0;
    for (const [e, s] of score) {
        const v = s * (1 - linkDensity(e));
        if (v > bs) {
            bs = v;
            best = e;
        }
    }
    return toText(best ?? doc.querySelector("article, main") ?? doc.body, imgs);
}
const meta = (doc, k) => doc.querySelector(`meta[property="${k}"], meta[name="${k}"]`)?.getAttribute("content")?.trim() ?? "";
export async function importArticle(id, raw) {
    let u;
    try {
        u = new URL(raw.trim());
    }
    catch {
        return { ok: false, reason: "url" };
    }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password)
        return { ok: false, reason: "url" };
    if (privateHost(u.hostname))
        return { ok: false, reason: "private" };
    const slug = await slugOf(u.href), file = `context/refs/url-${slug}.md`;
    const cached = await wread(id, file);
    if (cached)
        return { ok: true, file, title: cached.match(/^title: (.*)$/m)?.[1] ?? "", chars: cached.length, image: cached.match(/^image: (context\/assets\/\S+)$/m)?.[1] ?? null, images: [...cached.matchAll(/^ {2}- \d+: (context\/assets\/\S+)$/gm)].map(x => x[1]) };
    const r = await safeCurl(rewrite(u).href, ["--max-filesize", String(MAX_PAGE), "-H", "accept: text/html,application/xhtml+xml"]);
    if (!r)
        return { ok: false, reason: (await pin(u)) ? "fetch" : "private" };
    const status = r.code, html = r.body;
    if (status === 401 || status === 403)
        return { ok: false, reason: "blocked" };
    if (status < 200 || status >= 300 || !html || html.length > MAX_PAGE)
        return { ok: false, reason: "fetch" };
    const doc = new DOMParser().parseFromString(html, "text/html");
    const title = (meta(doc, "og:title") || doc.querySelector("title")?.textContent || doc.querySelector("h1")?.textContent || "").replace(/\s+/g, " ").trim().replace(/ : 네이버 블로그$/, "");
    const date = meta(doc, "article:published_time") || (doc.querySelector(".se_publishDate, .blog_date, time")?.textContent ?? "").trim();
    const img = meta(doc, "og:image");
    const bodyImgs = [];
    const body = bodyOf(doc, bodyImgs);
    if (body.replace(/\[사진\]|##|\s/g, "").length < 300)
        return { ok: false, reason: "short" };
    // 대표 이미지 — 사용자 글의 사진(내 사진 후보). 8MB·이미지 형식만
    let image = null;
    const dirA = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (img && dirA) {
        try {
            image = await getImage(dirA, new URL(img, u.href).href, `og-${slug}`, `context/assets/url-${slug}`, null, /^image\/(jpeg|png|webp)/);
        }
        catch { /* 대표 이미지 없이 */ }
    }
    // 본문 사진(2026-10-08 대표 "블로그 이미지 보고 제대로 된 레이아웃으로") — 글 순서대로 최대 12장. 이미지 형식·2KB 넘는 것만, 실패한 장은 건너뛴다
    const images = [];
    for (let k = 0; dirA && k < Math.min(bodyImgs.length, 12); k++) {
        try {
            const iu = new URL(bodyImgs[k], u.href);
            if (/pstatic\.net$/.test(iu.hostname) && iu.searchParams.has("type"))
                iu.searchParams.set("type", "w966"); // 네이버 원본 크기
            const rel = await getImage(dirA, iu.href, `img-${slug}-${k + 1}`, `context/assets/url-${slug}-${k + 1}`, `${u.origin}/`, /^image\/(jpeg|png|webp|gif)/);
            if (rel)
                images.push(`${k + 1}: ${rel}`);
        }
        catch { /* 이 장은 없이 */ }
    }
    const esc = (v) => v.replace(/\n/g, " ").slice(0, 300);
    await wput(id, file, `---\ntitle: ${esc(title)}\nurl: ${esc(u.href)}\ndate: ${esc(date)}\nimage: ${esc(image ?? img)}\n${images.length ? `images:\n${images.map(x => `  - ${x}`).join("\n")}\n` : ""}---\n\n# ${title}\n\n${body}\n`);
    return { ok: true, file, title, chars: body.length, image, images: images.map(x => x.split(": ")[1]) };
}
