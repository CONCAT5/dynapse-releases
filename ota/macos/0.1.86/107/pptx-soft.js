// PPTX 다시 들이기의 부드러운 줄바꿈(#164) — PPTX엔 앱이 잰 줄 자리마다 <a:br/>가 있다(PowerPoint가 다시 접지 않게). 그 줄바꿈은 사용자가 넣은 것이 아니라
// 다시 들일 때 지운다. #164부터 PPTX엔 U+200B 표시가 없고, 표시는 내보낼 때의 manifest 글(앞 글 끝 U+200B + "\n")에만 있다 → 그 앞뒤 글자가 같은 줄바꿈을 지운다.
// 예전 PPTX(글에 U+200B가 있음)도 그대로 지운다. 순수 함수 — 앱(pptxRoundtrip)과 turn-sim이 같은 것을 쓴다
export function softJoin(pptText, manifestText) {
    let t = pptText.replace(/​\n/g, "").replace(/​/g, "");
    for (const m of manifestText.matchAll(/([^\n​]{1,8})​\n([^\n​]{1,8})/g))
        t = t.replace(`${m[1]}\n${m[2]}`, m[1] + m[2]);
    return t;
}
export const manifestPlain = (manifestText) => manifestText.replace(/​\n/g, "").replace(/​/g, "");
