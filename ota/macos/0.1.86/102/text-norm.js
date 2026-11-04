// 글 비교 전 공통 정리(대표 2026-10-27 — C5 S1 2회차 채점이 "10⁠월"의 줄 묶음 표시 U+2060 때문에 넣은 날짜를 못 찾았다).
// NFKC(전각 숫자·호환 글자 → 보통 글자, NBSP·전각 공백 → 공백) · 보이지 않는 글자(폭 없는 공백·줄 묶음·BOM·soft hyphen) 제거 · 공백 하나로.
// 숫자 보존·원문 고정·사실 장부·벤치 채점이 모두 이것으로 비교한다. verify.mjs는 따로 도는 스크립트라 아래 /*@norm*/ 두 줄을 그대로 복사해 두고 turn-sim이 같은지 본다
/*@norm*/ const INVISIBLE = /[​-‍⁠﻿­]/g;
/*@norm*/ const normText = (t) => String(t ?? "").normalize("NFKC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
// 공백까지 뺀 꼴 — "10월 31일"과 "10월31일"을 같게 볼 때
export const squash = (t) => normText(t).replace(/\s+/g, "");
export { INVISIBLE, normText };
