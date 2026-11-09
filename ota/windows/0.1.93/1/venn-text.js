// 순수 함수 — 사다리(form-alts)·turn-sim이 같은 것을 쓴다
// 벤 글(#212 ③ — 라벨이 문장 토막 "사진 찍는 토요일…", 교집합이 제목 복붙, 발주 안내문 "가상의 학교·동아리로"가 라벨에): 라벨은 명사구 2~6자(조사 앞에서 끊기, 안 되면 벤 후보 아님),
// 안내문·면책은 라벨·항목에서 빼고, 교집합은 두 항목의 공통 낱말(없으면 부제의 한 낱말 · 제목은 쓰지 않는다)
export const DISCLAIM = /가상의|디자인\s*예시|\(예시\)|예시(입니다|예요|이에요)|실제와\s*다를|sample|placeholder/i;
const JOSA = /(에서|으로|에게|까지|부터|처럼|보다|하고|이랑|랑|은|는|이|가|을|를|과|와|의|에|로|도|만)$/;
export function nounPhrase(s) {
    const t = s.replace(/[…".,!?·:;()\[\]'"“”‘’]/g, " ").trim();
    if (!t || DISCLAIM.test(s))
        return null;
    const w = t.split(/\s+/), first = w[0].replace(JOSA, "");
    const one = t.length <= 6 ? t : first.length >= 2 && first.length <= 6 ? first : null;
    return one && one.length >= 2 && one.length <= 6 && !/\d{3,}/.test(one) ? one : null;
}
const nounsOf = (s) => s.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).map(x => x.replace(JOSA, "")).filter(x => x.length >= 2 && x.length <= 6);
export function vennText(c) {
    const s = c.items.filter(x => !DISCLAIM.test(`${x.head} ${x.desc}`)).slice(0, 3);
    if (s.length < 2)
        return null;
    const labels = s.map(x => nounPhrase(x.head));
    if (labels.some(l => !l) || new Set(labels).size < labels.length)
        return null;
    const ws = s.map(x => new Set(nounsOf(`${x.head} ${x.desc}`))), title = new Set(nounsOf(c.title));
    const common = [...ws[0]].find(w => ws.every(x => x.has(w)) && !labels.includes(w));
    // 공통 낱말 → 부제의 한 낱말 → 항목 글의 한글 낱말(라벨·제목 낱말 말고) — 제목을 통째로 넣지 않는다
    const pick = (t) => nounsOf(t).find(w => /^[가-힣]{2,}$/.test(w) && !labels.includes(w) && !title.has(w));
    const center = common ?? pick(DISCLAIM.test(c.lead) ? "" : c.lead) ?? pick(s.map(x => `${x.head} ${x.desc}`).join(" ")) ?? null;
    if (!center)
        return null;
    return { sets: labels.map(l => ({ label: l })), center, items: s.map(x => x.desc).filter(d => d && !DISCLAIM.test(d)).map(d => d.slice(0, 28)).slice(0, 3) };
}
