// 장 글·원고에 같이 있는 명사 하나(README §2 ①②) — 요점(emphasis)에 있는 것 먼저, 그다음 장 글에서 앞에 나온 것, 같은 자리면 긴 낱말.
// 이미 쓴 그림은 건너뛴다. caution: info = 효능을 말하는 장(%·효과·예방률)엔 안 씀 · amount = 요점이 금액인 장에만
export function pickArt(ix, pageText, manuscript, emphasis = "", used = []) {
    const sq = (t) => t.replace(/\s+/g, "");
    const pt = sq(pageText), ms = sq(manuscript), em = sq(emphasis);
    let best = null;
    for (const [noun, id, caution] of ix.nouns) {
        const n = sq(noun);
        if (!n || used.includes(id) || !ix.items[id] || !ms.includes(n))
            continue;
        const at = pt.indexOf(n);
        if (at < 0)
            continue;
        if (caution === "info" && /%|효과|효능|예방률|완치|개선/.test(pageText))
            continue;
        if (caution === "amount" && !/\d[\d,]*\s*(만\s*|억\s*)?원/.test(emphasis))
            continue;
        const rank = (em.includes(n) ? 0 : 1e6) + at * 10 - n.length;
        if (!best || rank < best.rank)
            best = { noun, id, rank };
    }
    return best ? { noun: best.noun, id: best.id } : null;
}
// 색 충돌(README §2 ⑥ — 버터·갈색 장에 빨강·파랑 트럭): 그림의 진한 색 중 하나라도 팔레트 색상(강조·채도 있는 바탕)과 60° 넘게 떨어지면 충돌
const hsl = (hex) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d)
        h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s, l };
};
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
export function artClash(colors, accent, bg) {
    const pal = [accent, bg].filter((c) => !!c && /^#[0-9a-f]{6}$/i.test(c)).map(hsl).filter((c, i) => i === 0 || c.s >= 0.2);
    if (!pal.length)
        return false;
    return colors.map(hsl).filter(c => c.s >= 0.45 && c.l >= 0.2 && c.l <= 0.85).some(c => pal.every(p => hueGap(c.h, p.h) > 60));
}
// 플랫 SVG를 팔레트로 칠하기(README §2 ⑥) — 원래 색의 밝기 순서를 강조색 농도로 옮긴다(밝음 → 강조 18% · 중간 → 55%·100% · 어두움 → 강조 60% + 검정)
export function recolourSvg(svg) {
    const mix = (hex) => {
        const { l } = hsl(hex), a = "var(--color-semantic-accent-base,#888)";
        return l >= 0.78 ? `color-mix(in oklab, ${a} 18%, #fff)` : l >= 0.55 ? `color-mix(in oklab, ${a} 55%, #fff)` : l >= 0.3 ? a : `color-mix(in oklab, ${a} 60%, #000)`;
    };
    return svg.replace(/<\?xml[^>]*>\s*/i, "").replace(/(<[a-z]+\b[^>]*?)\sfill="(#[0-9a-fA-F]{6})"([^>]*>)/g, (m, a, hex, b) => (/\sstyle\s*=/.test(a + b) ? m : `${a} style="fill:${mix(hex)}"${b}`));
}
// 놓을 자리(3D PNG 원본이 256px라 300px까지 — 더 키우면 흐리다) — 내용 상자 아래 띠(오른쪽 끝에 붙임) 또는 오른쪽 띠(내용 높이 가운데). 쪽 번호·꼬리말 상자와 겹치지 않게, 장 가장자리 여백 안. 너무 작으면 놓지 않음
export function artRect(sp) {
    // 빈 사진 자리(사진 칸인데 사진이 아직 없음)가 있으면 그 가운데 — 그림이 사진 자리를 채운다(round 12: 모서리에 놓인 그림이 빈 판 위에 떠 보였다). 사진이 오면 photo-runner가 그 그림을 지운다
    const hole = [...(sp.holes ?? [])].sort((a, b) => (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]))[0];
    if (hole) {
        const [a, b, c, d] = hole.box, s = Math.round(Math.min(320, Math.min(c - a, d - b) * 0.6));
        if (s >= Math.min(sp.W, sp.H) * 0.15)
            return { x: Math.round((a + c) / 2 - s / 2), y: Math.round((b + d) / 2 - s / 2), s, slot: hole.slot };
    }
    const { W, H } = sp, [x0, y0, x1, y1] = sp.box, m = Math.round(Math.min(W, H) * 0.06), gap = Math.round(Math.min(W, H) * 0.03);
    const maxS = Math.min(300, Math.round(Math.min(W, H) * 0.36)), minS = Math.round(Math.min(W, H) * 0.17);
    const hit = (r) => sp.avoid.some(([a, b, c, d]) => r.x < c + gap && r.x + r.s > a - gap && r.y < d + gap && r.y + r.s > b - gap);
    const out = [];
    // 아래: 오른쪽 끝, 바닥은 그 아래 꼬리말 위까지
    {
        let bottom = H - m;
        for (const [a, b, c] of sp.avoid)
            if (b > y1 && c > W - m - maxS && a < W - m)
                bottom = Math.min(bottom, b - gap);
        const s = Math.min(maxS, bottom - (y1 + gap), W - 2 * m);
        if (s >= minS)
            out.push({ x: W - m - s, y: bottom - s, s });
    }
    // 오른쪽: 내용 높이 가운데
    {
        const s = Math.min(maxS, W - m - (x1 + gap), H - 2 * m);
        if (s >= minS) {
            const cy = (y0 + y1) / 2;
            out.push({ x: W - m - s, y: Math.round(Math.max(m, Math.min(H - m - s, cy - s / 2))), s });
        }
    }
    const ok = out.filter(r => !hit(r)).sort((a, b) => b.s - a.s);
    return ok[0] ? { x: Math.round(ok[0].x), y: Math.round(ok[0].y), s: Math.round(ok[0].s) } : null;
}
// 장 HTML에 그림 하나(</section> 앞) + 머리에 출처 표(라이선스 줄이 읽는다). 이미 있던 앱 그림은 지우고 다시
export function placeArtHtml(html, art, r) {
    const pos = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.s}px;height:${r.s}px;z-index:1;pointer-events:none;margin:0`;
    const attrs = `data-art="fluent:${art.id}" data-art-style="${art.style}" data-art-size="big" data-art-noun="${art.noun.replace(/"/g, "")}"${r.slot ? ` data-art-slot="${r.slot.replace(/[^\w-]/g, "")}"` : ""}`;
    const el = art.style === "flat" && art.svg
        ? `<figure ${attrs} aria-hidden="true" style="${pos}">${art.svg.replace(/<svg\b/i, '<svg width="100%" height="100%"')}</figure>`
        : `<img ${attrs} alt="" src="${art.src}" style="${pos};object-fit:contain">`;
    let out = stripArt(html);
    const k = out.lastIndexOf("</section>");
    if (k < 0)
        return html;
    out = `${out.slice(0, k)}${el}\n${out.slice(k)}`;
    if (!/<meta\s+name="dynapse-art"/i.test(out))
        out = out.replace(/<\/head>/i, `<meta name="dynapse-art" content="Microsoft Fluent Emoji (MIT)">\n</head>`);
    return out;
}
// 그 사진 자리에 놓은 그림만 지운다(사진이 왔을 때 — photo-runner setSlotImg)
export const stripSlotArt = (html, slot) => { const s = slot.replace(/[^\w-]/g, ""); return html.replace(new RegExp(`\\s*<figure\\b[^>]*\\bdata-art-slot="${s}"[^>]*>[\\s\\S]*?<\\/figure>`, "gi"), "").replace(new RegExp(`\\s*<img\\b[^>]*\\bdata-art-slot="${s}"[^>]*>`, "gi"), ""); };
export const stripArt = (html) => html.replace(/\s*<figure\b[^>]*\bdata-art\s*=[^>]*>[\s\S]*?<\/figure>/gi, "").replace(/\s*<img\b[^>]*\bdata-art\s*=[^>]*>/gi, "");
