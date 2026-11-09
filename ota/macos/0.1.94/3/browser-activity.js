export const ACTIVITIES = [
    { id: "research_compare", name: "조사 · 비교", grade: "E0", output: "채팅 표 → [작업에 넣기](#72)", status: "partial", tests: ["rtask.R02", "rtask.R04", "e0."], why: "[작업에 넣기]는 C 다음 묶음" },
    { id: "collect", name: "수집", grade: "E0", output: "표 · CSV + 출처 링크 → 참고 모음", status: "open", tests: ["rtask.R03", "rtask.R05", "w03.dl_"] },
    { id: "summarize_ask", name: "요약 · 질문", grade: "E0", output: "채팅", status: "open", tests: ["rtask.R07", "rtask.R08", "observe."] },
    { id: "design_ref", name: "디자인 참고 담기", grade: "E0 + 비공개 캡처", output: "참고 모음(글 · 사진 · 로고 · 글꼴은 가져오지 않음)", status: "partial", tests: ["rtask.R06"], why: "참고 모음 담기(#73)는 C 다음 묶음" },
    { id: "form_fill", name: "폼 채우기", grade: "E1 넣기 · E2 제출", output: "W8 카드 → 결과 줄", status: "open", tests: ["w01.", "w02.", "act.", "e2."] },
    { id: "publish_prep", name: "게시 준비", grade: "E1 임시 저장 · E2 발행", output: "W8 카드 → 결과 줄 → 공개 이력(#74)", status: "open", tests: ["w06.", "upload.", "w03.normal"] },
    { id: "confirm_reflect", name: "반영 확인", grade: "E0", output: "작업 공개 이력(#74)", status: "open", tests: ["e.", "w05.", "upload_lost."] },
    { id: "my_stats", name: "내 통계 읽기", grade: "E0", output: "성과 카드", status: "closed", tests: [], why: "F(로그인된 화면 읽기) 뒤" },
    { id: "repeat", name: "반복", grade: "레시피", output: "레시피 실행", status: "closed", tests: [], why: "W9(레시피) 뒤" },
];
// 사람 문장 → 활동(기록용 · 화면에 쓰지 않는다). 앞의 규칙이 이긴다. 금지 꼴은 browser-intent가 빼고 넘긴다
const RULES = [
    ["design_ref", /참고로\s*(담아|모아|저장)|디자인\s*참고/],
    ["my_stats", /내\s*(통계|성과|조회수|매출|대시보드|광고)/],
    ["repeat", /매일|매주|매달|반복해|정기적으로/],
    ["confirm_reflect", /(반영|올라갔|게시됐|들어갔|바뀌었).{0,12}(확인|봐)/],
    ["publish_prep", /게시|발행|올려|올리|업로드|배포|publish|deploy|upload/i],
    ["form_fill", /넣어|넣고|입력|채워|작성|신청|예약|등록|fill|type/i],
    ["collect", /모아|수집|목록|리스트|표로|csv|정리해/i],
    ["research_compare", /비교|조사|찾아|알아봐|research|compare/i],
];
export function activityOf(text) { for (const [id, re] of RULES)
    if (re.test(text))
        return id; return "summarize_ask"; }
