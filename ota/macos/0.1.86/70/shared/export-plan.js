// 판형 — format.json의 frame이 먼저. 없으면 장 이름(result-card-N = 카드), 그 밖은 슬라이드
export function exportFrame(frame, files = []) {
    const f = (frame ?? "").trim();
    if (/^print(:|$)/.test(f))
        return "print";
    if (f === "card" || f === "card45")
        return "card";
    if (f === "detail")
        return "detail";
    if (f === "a4")
        return "doc";
    if (f === "slide")
        return "slide";
    return files.some(n => /^result-card-\d+\.html$/.test(n)) ? "card" : "slide";
}
export function exportPlan(frame) {
    switch (frame) {
        case "card": return { frame, main: { kind: "png2x", label: "내보내기", done: "인스타·블로그에 그대로 올려요" },
            alts: [{ kind: "pdf", label: "PDF · 한 파일로 모아서" }, { kind: "pptx", label: "PPTX · 발표용" }, { kind: "instagram", label: "인스타 · 캡션 같이" }] };
        case "detail": return { frame, main: { kind: "detail", label: "내보내기", done: "스마트스토어·쿠팡에 올리는 긴 그림" },
            alts: [{ kind: "pdf", label: "PDF · 한 파일로 모아서" }, { kind: "png", label: "PNG · 장마다 따로" }] };
        case "print": return { frame, main: { kind: "print", label: "내보내기", done: "인쇄소에 보내요 · 재단 여유 3mm 포함" },
            alts: [{ kind: "pdf", label: "PDF · 보기용(재단 없이)" }, { kind: "print-marks", label: "PDF · 재단 표시 판도 같이" }, { kind: "png", label: "PNG · 미리보기 그림" }] };
        case "doc": return { frame, main: { kind: "pdf", label: "내보내기", done: "그대로 인쇄하거나 보내요" },
            alts: [{ kind: "pptx", label: "PPTX · 고칠 수 있게" }, { kind: "png", label: "PNG · 장마다 따로" }] };
        // 발표 덱은 PDF 한 파일이 기본(#308 보정 2 — 대표 10-27 "내보내기 PDF 묶음이 기본, PPT는 서브"): 본 장만(#308 보정 1 길) · PPTX는 첫 번째 다른 방법
        default: return { frame: "slide", main: { kind: "pdf", label: "내보내기", done: "PDF 한 파일 · 그대로 보내요" },
            alts: [{ kind: "pptx", label: "PPTX · PowerPoint에서 고칠 수 있게" }, { kind: "png2x", label: "PNG · 장마다 따로" }, { kind: "pptx-safe", label: "PPTX · 학교·회사 PC용(글꼴 없이)" }] };
    }
}
