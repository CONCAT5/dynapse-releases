// 글 주소 → 원고(#83 §1) — 사용자가 붙인 주소 1개만 앱이 가져와 본문·제목·날짜·대표 이미지를 뽑는다. AI 턴 전, 토큰 0.
// 가져오기 = OS curl(GET·http(s)만·리다이렉트 3·15초·5MB) · 뽑기 = 웹뷰의 DOMParser(readability 축약: 문단 점수가 가장 큰 블록).
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
const curlArgs = (url, extra) => ["-sSL", "--max-redirs", "3", "--max-time", "15", "--proto", "=http,https", "--proto-redir", "=http,https", "-A", UA, "-H", "accept-language: ko,en;q=0.8", ...extra, url];
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
        if (tag === "IMG") {
            const src = e.getAttribute("data-lazy-src") || e.getAttribute("data-src") || e.getAttribute("src") || "";
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
    const r = await exec("curl", curlArgs(rewrite(u).href, ["--max-filesize", "5000000", "-H", "accept: text/html,application/xhtml+xml", "-w", "\n%{http_code}"])).catch(() => null);
    if (!r || r.code !== 0)
        return { ok: false, reason: "fetch" };
    const i = r.stdout.lastIndexOf("\n"), status = Number(r.stdout.slice(i + 1)), html = r.stdout.slice(0, i);
    if (status === 401 || status === 403)
        return { ok: false, reason: "blocked" };
    if (status < 200 || status >= 300 || !html)
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
    if (img) {
        try {
            const iu = new URL(img, u.href);
            if (/^https?:$/.test(iu.protocol) && !privateHost(iu.hostname)) {
                const ext = /\.png(\?|$)/i.test(iu.pathname) ? "png" : /\.webp(\?|$)/i.test(iu.pathname) ? "webp" : "jpg";
                const dir = await T().core.invoke("work_dir", { id });
                const rel = `context/assets/url-${slug}.${ext}`;
                // 먼저 .dynapse/tmp로 받아 이미지인지 본 뒤에만 내 사진 자리로(실패한 응답 본문이 사진 파일로 남지 않게 — 지울 명령이 없다)
                const probe = await exec("curl", curlArgs(iu.href, ["--fail", "--max-filesize", "8000000", "--create-dirs", "-o", `${dir}/.dynapse/tmp/og-${slug}`, "-w", "%{http_code} %{content_type} %{size_download}"])).catch(() => null);
                const [code, type, size] = (probe?.stdout ?? "").trim().split(" ");
                if (probe?.code === 0 && code === "200" && /^image\/(jpeg|png|webp)/.test(type ?? "") && Number(size) > 2000) {
                    const real = /png/.test(type) ? "png" : /webp/.test(type) ? "webp" : "jpg", relx = rel.replace(/\.\w+$/, `.${real}`);
                    const got = await exec("curl", curlArgs(iu.href, ["--fail", "--max-filesize", "8000000", "--create-dirs", "-o", `${dir}/${relx}`])).catch(() => null);
                    if (got?.code === 0)
                        image = relx;
                }
            }
        }
        catch { /* 대표 이미지 없이 */ }
    }
    // 본문 사진(2026-10-08 대표 "블로그 이미지 보고 제대로 된 레이아웃으로") — 글 순서대로 최대 12장. 이미지 형식·2KB 넘는 것만, 실패한 장은 건너뛴다
    const images = [];
    const dirA = await T().core.invoke("work_dir", { id }).catch(() => null);
    for (let k = 0; dirA && k < Math.min(bodyImgs.length, 12); k++) {
        try {
            const iu = new URL(bodyImgs[k], u.href);
            if (!/^https?:$/.test(iu.protocol) || privateHost(iu.hostname))
                continue;
            if (/pstatic\.net$/.test(iu.hostname) && iu.searchParams.has("type"))
                iu.searchParams.set("type", "w966"); // 네이버 원본 크기
            const tmp = `${dirA}/.dynapse/tmp/img-${slug}-${k + 1}`;
            const probe = await exec("curl", curlArgs(iu.href, ["--fail", "--max-filesize", "8000000", "-H", `referer: ${u.origin}/`, "--create-dirs", "-o", tmp, "-w", "%{http_code} %{content_type} %{size_download}"])).catch(() => null);
            const [code, type, size] = (probe?.stdout ?? "").trim().split(" ");
            if (probe?.code !== 0 || code !== "200" || !/^image\/(jpeg|png|webp|gif)/.test(type ?? "") || Number(size) < 2000)
                continue;
            const ext = /png/.test(type) ? "png" : /webp/.test(type) ? "webp" : /gif/.test(type) ? "gif" : "jpg";
            const rel = `context/assets/url-${slug}-${k + 1}.${ext}`;
            const got = await exec("curl", curlArgs(iu.href, ["--fail", "--max-filesize", "8000000", "-H", `referer: ${u.origin}/`, "--create-dirs", "-o", `${dirA}/${rel}`])).catch(() => null);
            if (got?.code === 0)
                images.push(`${k + 1}: ${rel}`);
        }
        catch { /* 이 장은 없이 */ }
    }
    const esc = (v) => v.replace(/\n/g, " ").slice(0, 300);
    await wput(id, file, `---\ntitle: ${esc(title)}\nurl: ${esc(u.href)}\ndate: ${esc(date)}\nimage: ${esc(image ?? img)}\n${images.length ? `images:\n${images.map(x => `  - ${x}`).join("\n")}\n` : ""}---\n\n# ${title}\n\n${body}\n`);
    return { ok: true, file, title, chars: body.length, image, images: images.map(x => x.split(": ")[1]) };
}
