// 장 전체를 다시 짜라는 말 — 이때만 📍가 있어도 장 범위
export const WHOLE_WORDS = /장\s*전체|페이지\s*전체|슬라이드\s*전체|통째|다\s*다시|전부\s*다시|처음부터\s*다시|whole (page|slide)|entire (page|slide)|redo the (page|slide)/i;
// 장 시각화(#197) — "이 장 그림으로 설명되게" 한 문장. 장 전체를 설명 그림 레이아웃으로 바꾸는 턴(📍 경계 밖이라도 된다)
export const EXPLAIN_WORDS = /그림으로\s*(설명|보여|바꿔|만들|정리|풀어)|그림\s*한\s*장으로|그림으로\s*보이게|설명\s*그림으로|explain (it |this )?(visually|with (a|an) (picture|illustration))|as an? (explainer|visual explanation)/i;
// 📍가 있을 때 덱 범위는 덱을 분명히 말할 때만("제대로"·"구조"는 덱 말이 아니다 — 대표 "제대로 위치 잡아봐"가 덱 턴이 됐다)
export const DECK_STRICT = /모든 ?장|덱 ?전체|whole deck|every (page|slide)|장\s*순서|순서\s*(바꿔|바꾸|정리)|장\s*(을|를)?\s*(추가|삭제|빼|넣)/i;
// 넘침·줄바꿈 불만 — 📍 요소면 먼저 앱의 맞춤(0토큰), 그래도 넘치면 AI
export const FIT_WORDS = /넘쳐|넘치|넘어가|넘어간|삐져|삐저|잘려|잘리|줄\s*바꿈|두\s*줄|세\s*줄|한\s*줄로|overflow|overflows|wraps?\b|cut off/i;
export const BOUND_LINE = "📍 = the target. Change only that element (and its parent block if it must resize); every other element keeps its position, size and text — no re-layout unless the request says the whole page.";
export const BOUND_RETRY = "Your change moved or changed elements outside the 📍 element and its parent block, so the app restored the page. Do the request again, changing only the 📍 element (and its parent block if it must resize). Leave every other element exactly where it is.";
// 상자 열쇠 — verify --tidboxes와 같은 규칙(문서 순서 · tid가 먼저 · 같은 열쇠는 #n)
function keysOf(doc) {
    const out = new Map(), seen = new Map();
    for (const e of Array.from(doc.querySelectorAll("[data-tid],[data-slot]"))) {
        if (e.closest("[data-dyn],script,style,template"))
            continue;
        const tid = e.getAttribute("data-tid"), slot = e.getAttribute("data-slot");
        let k = tid ? `tid:${tid}` : `slot:${slot}`;
        const n = seen.get(k) ?? 0;
        seen.set(k, n + 1);
        if (n)
            k += `#${n}`;
        out.set(e, k);
    }
    return out;
}
// 바뀌어도 되는 열쇠 — 📍 요소와 그 부모 블록(장 바로 아래 칸이면 그 요소만) 안의 모든 요소
export function exemptKeys(html, sels) {
    const doc = new DOMParser().parseFromString(html, "text/html"), keys = keysOf(doc), ex = new Set();
    const sec = doc.querySelector("section.slide, .slide, section");
    for (const sel of sels) {
        let el = null;
        try {
            el = doc.querySelector(sel);
        }
        catch {
            el = null;
        }
        if (!el)
            continue;
        const parent = el.parentElement && el.parentElement !== sec && el.parentElement !== doc.body ? el.parentElement : el;
        for (const [e, k] of keys)
            if (parent === e || parent.contains(e))
                ex.add(k);
    }
    return ex;
}
// 경계 밖에서 움직이거나(±2px) 글이 바뀌거나 사라진 요소
export function violations(before, after, exempt, tol = 2) {
    const out = [];
    for (const [k, b] of Object.entries(before)) {
        if (exempt.has(k))
            continue;
        const a = after[k];
        if (!a) {
            out.push(`${k} 사라짐`);
            continue;
        }
        if (Math.abs(a.x - b.x) > tol || Math.abs(a.y - b.y) > tol || Math.abs(a.w - b.w) > tol || Math.abs(a.h - b.h) > tol)
            out.push(`${k} 움직임(${b.x},${b.y} ${b.w}×${b.h} → ${a.x},${a.y} ${a.w}×${a.h})`);
        else if (a.t !== b.t)
            out.push(`${k} 글 바뀜`);
    }
    return out;
}
// 상대 경로가 그대로 풀리게(.dynapse/out에 둔 시작 판) — <head> 바로 뒤에 <base href="../../">
export const withBase = (html) => /<base\b/i.test(html) ? html : html.replace(/<head(\s[^>]*)?>/i, m => `${m}<base href="../../">`);
