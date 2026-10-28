// "내 글 그대로"의 대상(#192 — 대표가 멘토 피드백·수정 지시서를 붙이자 지시 산문 78줄 전체를 원고로 검사해 반려가 이어졌다).
// 원고 = 표시된 문구만: 코드 블록 · 따옴표 문구(“…” "…" '…' «…» 「…」 『…』) · "제목:" 같은 이름표 줄. 지시 산문(고쳐 줘·배경 설명·표)은 원고가 아니다.
// 비교는 끝 구두점·공백·줄바꿈을 정규화(제목 끝 마침표를 빼도 통과). 순수 함수 — 앱(verbatim.json 쓰기)·turn-sim이 같은 것을 쓴다
const LABEL = /^\s*[-*•]?\s*(제목|부제|소제목|본문|문구|카피|헤드라인|슬로건|캡션|title|subtitle|headline|body|copy|caption|tagline)\s*[:：]\s*(.+?)\s*$/i;
const QUOTE = /“([^”\n]{2,200})”|"([^"\n]{2,200})"|«([^»\n]{2,200})»|「([^」\n]{2,200})」|『([^』\n]{2,200})』|‘([^’\n]{2,200})’|(?<![A-Za-z])'([^'\n]{2,200})'(?![A-Za-z])/g;
// 지시·요청·불만 꼴 — 줄 끝(…해 줘·…해 봐·…하세요·…잖아·?) 또는 고치라는 말
const ASK = /(해\s*줘|해\s*주세요|해\s*봐|해\s*보세요|하세요|하자|해라|바꿔|빼\s*(줘|주세요)?|넣어|줄여|키워|고쳐|옮겨|맞춰|없애|살려|지워|정리|수정|삭제|추가|필요|좋겠|좋을\s*듯|해야|하지\s*마|않게|잖아|는데|인데|어때|할까|\?|？)\s*[.!~…]*\s*$/;
export function markedCopy(text) {
    const out = [];
    const body = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code) => { for (const l of code.split("\n"))
        if (l.trim())
            out.push(l.trim()); return "\n"; });
    for (const line of body.split("\n")) {
        const lb = line.match(LABEL);
        if (lb) {
            out.push(lb[2].replace(/^["“'‘«「『]|["”'’»」』]$/g, "").trim());
            continue;
        }
        for (const q of line.matchAll(QUOTE)) {
            const v = (q.slice(1).find(Boolean) ?? "").trim();
            if (v.length >= 2)
                out.push(v);
        }
    }
    const lines = [...new Set(out.filter(x => x.length >= 2))].slice(0, 400);
    return { lines, marked: lines.length > 0 };
}
// 지시 산문인가 — 의미 있는 줄 중 30% 이상이 지시·요청·불만 꼴이면 지시서(원고 아님)
export function instructionLike(text) {
    const ls = text.split("\n").map(l => l.replace(/^\s*([-*•]|\d+[.)])\s*/, "").trim()).filter(l => l.length >= 4 && !/^\|/.test(l));
    if (!ls.length)
        return false;
    return ls.filter(l => ASK.test(l)).length / ls.length >= 0.3;
}
// 비교용 — 끝 구두점·공백·줄바꿈 정규화
export const normCopy = (s) => s.replace(/[\s ⁠]+/g, " ").trim().replace(/[\s.。．!！?？…·,，]+$/u, "");
