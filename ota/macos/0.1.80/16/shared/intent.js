// 자동 복사: prototypes/hub/src/lib/intent.ts — 수정 금지
// 작업 지시 vs 덱 재료(#140 추가 2 — 2026-10-17 필름 제작 지시서를 붙여넣자 그 지시서에 관한 80장 덱을 28분 동안 만들었다). import 없는 파일 — 앱이 복사해 쓴다(sync-tokens → desktop src/shared/intent.ts)
// 지시로 읽히면 덱을 만들지 않고 한 줄("디냅스는 덱을 만들어요 · 이 일은 Codex나 Claude Code 터미널에서 돼요 [지시 복사] [이 글로 덱 만들기]").
// 강한 신호: requests/*.md·WORKORDER·"지시서"·"~대로 해줘/진행해" · 명령어 블록(```bash, $ …, pnpm/npm/git/node/ffmpeg 줄) · 덱 밖 동사(녹화·화면 캡처·영상 합치기·설치·실행·파일 저장)가 둘 이상.
// 덱이라고 직접 말하면(덱·슬라이드·카드뉴스·N장으로 만들어 …) 지시가 아니다. 내보내기(PDF·PPTX·PNG로 저장·받기)는 덱 동작이라 덱 밖 동사로 세지 않는다
const DECK_ASK = /(덱|슬라이드|장표|카드\s*뉴스|카드뉴스|PPT|발표\s*자료|소개\s*자료|제안서|보고서|\d+\s*장(으로|짜리|쯤)?)\s*(로|으로|을|를)?\s*(새로\s*)?(만들|정리|써|구성|바꿔)/i;
const EXPORT = /(PDF|PPTX|PNG|JPG|이미지|파일)\s*(로|으로)\s*(저장|받|내보내|뽑)/i;
const STRONG = [
    [/(^|[\s(`'"])requests\/[\w./-]+\.md\b/i, "requests 파일"],
    [/\bWORKORDER\b|작업\s*지시서|지시서/i, "지시서"],
    [/(대로|따라서?)\s*(해\s*줘|해줘|진행해|처리해|실행해|만들어\s*줘|작업해)/, "~대로 해줘"],
    [/```(bash|sh|zsh|shell|powershell|ps1)?\s*\n|^\s*\$\s+\S|^\s*(pnpm|npm|npx|git|node|ffmpeg|brew|winget|cd|curl|python3?)\s+\S/m, "명령어"],
];
const OUTSIDE = /(녹화|화면\s*캡처|캡처\s*(해|하고|떠)|영상\s*(을\s*)?(합치|이어\s*붙|편집)|합쳐\s*(서|줘)|이어\s*붙여|설치\s*(해|하고|하세요)|실행\s*(해|하고|하세요)|(파일|폴더|mp4|webm)(로|에|을)?\s*저장|업로드\s*해|커밋\s*해|배포\s*해)/g;
export function taskInstruction(text) {
    const t = text.slice(0, 20000);
    if (t.trim().length < 12)
        return null;
    const head = t.slice(0, 400);
    if (DECK_ASK.test(head) && !/(대로|따라서?)\s*(해\s*줘|해줘|진행해)/.test(head))
        return null; // 덱을 만들어 달라고 직접 말함(첫머리)
    const why = STRONG.filter(([re]) => re.test(t)).map(([, w]) => w);
    const outside = [...new Set((t.replace(EXPORT, " ").match(OUTSIDE) ?? []).map(x => x.replace(/\s+/g, "").slice(0, 4)))];
    if (outside.length >= 2)
        why.push(`덱 밖 동사 ${outside.slice(0, 3).join("·")}`);
    // 강한 신호 하나 + 덱 밖 동사 하나, 또는 강한 신호 둘, 또는 덱 밖 동사 둘 이상
    const strong = why.filter(w => !w.startsWith("덱 밖")).length, verbs = outside.length;
    return strong >= 2 || (strong >= 1 && verbs >= 1) || verbs >= 2 ? { why } : null;
}
