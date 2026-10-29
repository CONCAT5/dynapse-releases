// 나누기: "그리고·또·그다음", 줄바꿈, 번호(①·1)·1.), "~하고/~주고/~우고 …" 같은 동사 + 고. 쉼표는 장 이름 나열("22-a, 22-b를")이라 나누지 않는다
export function splitTasks(text) {
    const t = text.replace(/\[첨부:[^\]]*\]/g, " ").trim();
    const parts = t.split(/\s*(?:\n+|[;；]|(?:,\s*)?(?:그리고|그\s*다음(?:에)?|그다음(?:에)?|또한|또)\s+|\s(?=(?:[①-⑨]|\(?\d\)|\d\.)\s))\s*|(?<=(?:하|주|우|내|넣|빼|바꾸|옮기|보내|붙이|키우|줄이|지우|없애|올리|내리|늘리|만들)고)\s+/);
    // "…보내줘 긜고 …"(대표 실제 오타) — 줘·주세요로 끝난 뒤 말이 이어지면 거기서도 나누고, 앞머리의 짧은 이음말(그리고·긜고·또)은 뗀다
    // 쉼표는 앞 말이 요청으로 끝날 때만 나눈다(#331 — "…두 줄로, 위아래 여백 맞춰 줘, 전화번호는 숨기고, …"가 할 일 하나로 읽혔다) · 장 이름 나열("22-a, 22-b를")은 그대로
    const parts2 = parts.flatMap(x => x.split(/(?<=줘|주세요|줘요)\s+(?=\S)/)).flatMap(x => x.split(/(?<=(?:줘|주세요|줘요|해|해요|고|로|으로|게))\s*[,，]\s+/));
    const out = parts2.map(x => x.replace(/^(?:[①-⑨]|\(?\d\)|\d\.)\s*/, "").replace(/^(?:할\s*일\s*\d+\s*개\s*[:：]\s*)/, "").replace(/^(?:[가-힣]{1,3}고|또|그다음|그리고)\s+/, "").trim()).filter(x => x.length >= 2);
    return out.length ? out : [t];
}
const stem = (f) => f.replace(/^result-/, "").replace(/\.html$/, "");
const lev = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++)
        d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
};
// 장 이름 하나 → 파일. 정확히 같으면 그대로, 아니면 번호가 같고 글자 차이가 작은(이름 길이의 20%·최대 4) 하나. "02"처럼 번호만이면 그 번호로 시작하는 장이 하나일 때만
export function matchPage(said, pages) {
    const s = said.toLowerCase().replace(/^result-/, "").replace(/\.html$/, "");
    const exact = pages.find(f => stem(f) === s);
    if (exact)
        return exact;
    if (/^\d{1,3}$/.test(s)) {
        const hit = pages.filter(f => stem(f).split("-")[0] === s.padStart(2, "0"));
        return hit.length === 1 ? hit[0] : null;
    }
    const num = s.split("-")[0], cand = pages.filter(f => !/^\d/.test(num) || stem(f).split("-")[0] === num).map(f => ({ f, d: lev(s, stem(f)) })).sort((a, b) => a.d - b.d);
    const best = cand[0], lim = Math.min(4, Math.max(1, Math.round(s.length * 0.2)));
    return best && best.d <= lim && (cand.length < 2 || cand[1].d > best.d) ? best.f : null;
}
export function pageRefs(task, d) {
    const main = d.numbered;
    const out = [];
    for (const m of task.matchAll(/\b(?:result-)?(\d{1,3}(?:-[a-z0-9]+)+)(?:\.html)?\b/gi))
        out.push({ at: m.index, end: m.index + m[0].length, said: m[1], file: matchPage(m[1], d.names) });
    for (const m of task.matchAll(/(\d{1,2})\s*(?:번째\s*)?(?:장|페이지|슬라이드|번\s*장)/g)) {
        if (out.some(r => m.index >= r.at && m.index < r.end))
            continue;
        const n = Number(m[1]);
        out.push({ at: m.index, end: m.index + m[0].length, said: m[0], file: main[n - 1] ?? null });
    }
    for (const m of task.matchAll(/표지/g))
        out.push({ at: m.index, end: m.index + 2, said: "표지", file: main[0] ?? null });
    for (const m of task.matchAll(/마지막\s*(?:장|페이지|슬라이드)/g))
        out.push({ at: m.index, end: m.index + m[0].length, said: m[0].replace(/\s+/g, " "), file: main.at(-1) ?? null });
    for (const m of task.matchAll(/\b(\d{2})\s*(?=(?:번\s*)?(?:뒤|앞|다음))/g)) {
        if (out.some(r => m.index >= r.at && m.index < r.end))
            continue;
        out.push({ at: m.index, end: m.index + m[1].length, said: m[1], file: matchPage(m[1], d.names) });
    }
    return out.sort((a, b) => a.at - b.at);
}
// 순서·이동·삭제 할 일인가 — 장 이름이 모두 맞고 다른 일(글·사진·만들기)이 섞이지 않았을 때만 엔진이 한다
const OTHER = /글자|문구|제목|크게|작게|색|사진|그림|차트|만들|추가|써\s*줘|바꿔\s*(?!줘\s*$)|고쳐|키워|줄여|연락처|내용/;
export function parseOrderTask(task, d) {
    const t = task.trim(), refs = pageRefs(t, d);
    if (t.length > 120 || !refs.length || refs.some(r => !r.file))
        return null; // 긴 글(원고·흐름 설명)은 순서 요청이 아니다
    // 방향 말이 둘 이상이면(나누지 못한 두 요청) 엔진이 짐작하지 않는다 — AI 목록으로
    if ((t.match(/맨\s*뒤|맨\s*끝|맨\s*앞|마지막으로|처음으로|(?:뒤|앞|다음)\s*(?:으로|로|에)/g) ?? []).length > 1)
        return null;
    const fixed = refs.filter(r => r.file && stem(r.file) !== r.said.toLowerCase() && !/장|표지|페이지|슬라이드/.test(r.said) && !/^\d{2}$/.test(r.said)).map(r => ({ said: r.said, file: r.file }));
    const rel = t.match(/(뒤|다음|앞)\s*(?:으로|로|에)?\s*(?:붙여|보내|옮겨|넣어|놓아|둬|가|이동)?/);
    // 장 지우기는 장이 목적어일 때만("3장 지워", "3장을 삭제") — "2장 부제 지워줘"는 글 지우기(AI)
    if (/(?:장|페이지|슬라이드|[a-z0-9]-[a-z0-9-]+|표지)\s*(?:을|를|은|는|도)?\s*(?:통째로\s*)?(?:지워|지우|삭제|없애|빼\s*(?:줘|주세요|고|$)|제거)/.test(t) && !/부록/.test(t) && !OTHER.test(t))
        return { kind: "delete", subjects: [...new Set(refs.map(r => r.file))], fixed };
    if (/지워|지우|삭제|없애|제거/.test(t))
        return null;
    if (OTHER.test(t.replace(/맨\s*(뒤|앞)|뒤로|앞으로|다음으로/g, " ")))
        return null;
    if (/맨\s*뒤|맨\s*끝|마지막으로|끝으로|제일\s*뒤/.test(t))
        return { kind: "end", subjects: [...new Set(refs.map(r => r.file))], fixed };
    if (/맨\s*앞|처음으로|제일\s*앞|첫\s*(?:장|페이지)으로/.test(t))
        return { kind: "front", subjects: [...new Set(refs.map(r => r.file))], fixed };
    if (rel && refs.length >= 2) {
        // 기준 장 = 관계 말("뒤로·앞에") 바로 앞에 있는 장 이름
        const relAt = rel.index, before = refs.filter(r => r.end <= relAt + 1), target = before.at(-1);
        if (!target)
            return null;
        const subjects = [...new Set(refs.filter(r => r !== target).map(r => r.file))].filter(f => f !== target.file);
        if (!subjects.length)
            return null;
        return { kind: rel[1] === "앞" ? "before" : "after", subjects, target: target.file, fixed };
    }
    return null;
}
// 새 본편 순서(부록 밖). delete는 목록에서만 빼고(파일 지우기는 앱이), 나머지는 옮긴다
export function applyOp(main, op) {
    const rest = main.filter(f => !op.subjects.includes(f)), subs = main.filter(f => op.subjects.includes(f)).sort((a, b) => op.subjects.indexOf(a) - op.subjects.indexOf(b));
    if (op.kind === "delete")
        return rest;
    if (op.kind === "end")
        return [...rest, ...subs];
    if (op.kind === "front")
        return [...subs, ...rest];
    const i = rest.indexOf(op.target);
    if (i < 0)
        return main;
    return op.kind === "after" ? [...rest.slice(0, i + 1), ...subs, ...rest.slice(i + 1)] : [...rest.slice(0, i), ...subs, ...rest.slice(i)];
}
export const opLine = (op) => {
    const n = (f) => stem(f);
    return op.kind === "delete" ? `${op.subjects.map(n).join(", ")} 뺌` : op.kind === "end" ? `${op.subjects.map(n).join(", ")} 맨 뒤로` : op.kind === "front" ? `${op.subjects.map(n).join(", ")} 맨 앞으로`
        : `${op.subjects.map(n).join(", ")} → ${n(op.target)} ${op.kind === "after" ? "뒤로" : "앞으로"}`;
};
// 메시지 → 할 일. 할 일이 하나뿐이고 순서 일이 아니면 목록을 만들지 않는다(보통 턴 그대로)
export function readTasks(text, d) {
    return splitTasks(text).map(x => ({ text: x, op: parseOrderTask(x, d), pages: pageRefs(x, d).map(r => r.file).filter((f) => !!f) }));
}
