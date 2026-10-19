// AI 사용 기록(#153 ④ · 보정 1) — 내보내기 메뉴의 "AI 사용 기록". 이 작업의 TRACE에서 쓴 도구·모델·범위(장)·걸린 시간·사진 출처·레이아웃 고름·받아들인 문장 제안·
// "내 글 그대로" 여부·내가 쓴 글의 비율을 A4 한 장(넘치면 이어서)으로. 사용자 글 원문·요청 문장·AI 답은 싣지 않는다(학교 지침 형식: 도구 · 입력 · 반영 방식). 기본 꺼짐 — 누를 때만 만든다
import { T } from "./main.js";
import { readJson, wget } from "./chat.js";
const esc = (t) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const TOOL = { claude_code: "Claude Code", codex: "ChatGPT(Codex)", agy: "Gemini(Antigravity)", antigravity: "Gemini(Antigravity)", local: "이 PC 모델", dynapse: "디냅스 앱(AI 없음)" };
const PHOTO = { stock: "디냅스 재고", open: "공개 라이선스(CC0·CC BY)", agy: "Gemini로 생성", codex: "ChatGPT로 생성", generated: "AI로 생성", mine: "내 사진", local: "이 PC · 로컬" };
const pageWord = (f) => { const k = f.replace(/^result-|(\.[a-z]{2})?\.html$/g, ""); return k === "cover" ? "표지" : k === "closing" ? "마무리" : `${k}장`; };
const textOf = (h) => h.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&[a-z#0-9]+;/gi, "x").replace(/\s+/g, "");
export async function aiRecordHtml(id, title) {
    const tr = (await readJson(id, ".dynapse/TRACE.json").catch(() => null)) ?? {};
    const rounds = (tr.rounds ?? []).filter(r => r.commit);
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+\.html$/.test(n));
    const vb = await readJson(id, ".dynapse/verbatim.json").catch(() => null);
    const choices = (await readJson(id, ".dynapse/choices.json").catch(() => null)) ?? [];
    const plan = (await readJson(id, ".dynapse/plan.json").catch(() => null))?.pages ?? [];
    // 내가 쓴 글의 비율 — "내 글 그대로" 원고의 문장이 장 글에서 차지하는 글자 비율(원고가 없으면 표시하지 않는다)
    let share = null;
    if (vb?.text) {
        const deck = (await Promise.all(pages.map(f => wget(id, f).catch(() => null)))).map(h => textOf(h ?? "")).join("");
        const mine = [...new Set(vb.text.split(/\n+|(?<=[.!?。])\s+/).map(s => s.replace(/\s+/g, "")).filter(s => s.length >= 2))].filter(s => deck.includes(s)).reduce((a, s) => a + s.length, 0);
        if (deck.length)
            share = Math.min(100, Math.round((mine / deck.length) * 100));
    }
    const tools = new Map(), models = new Set();
    let polish = 0, restore = 0, write = 0, review = 0, secs = 0;
    const rows = rounds.map(r => {
        const tool = TOOL[r.runtime] ?? r.runtime;
        tools.set(tool, (tools.get(tool) ?? 0) + 1);
        if (r.model)
            models.add(r.model);
        const kind = r.role === "restore" ? (restore++, "되돌리기") : r.role === "review" ? (review++, "검토") : r.req?.kind === "click" ? "직접 고침" : r.req?.kind === "photo-late" ? "사진 교체" : /사람 말로 다듬어/.test(r.req?.text ?? "") ? (polish++, "문장 제안 받아들임") : (write++, "AI 편집");
        const t = r.timing?.total ?? 0;
        secs += t;
        const files = [...new Set((r.files ?? []).map(pageWord))];
        return `<tr><td>${r.n}</td><td>${esc(kind)}</td><td>${esc(tool)}${r.model ? `<br><small>${esc(r.model)}</small>` : ""}</td><td>${files.length ? esc(files.slice(0, 8).join(", ")) + (files.length > 8 ? ` 외 ${files.length - 8}` : "") : "—"}</td><td>${t ? `${t}초` : "—"}</td></tr>`;
    });
    const photo = new Map();
    for (const c of tr.children ?? []) {
        const k = PHOTO[c.runtime ?? ""] ?? null;
        if (k && c.page)
            photo.set(k, (photo.get(k) ?? 0) + 1);
    }
    const forms = plan.filter(p => p.page && p.form).map(p => `${pageWord(p.page)} ${p.form}`);
    const since = Object.values(tr.sessions ?? {}).map(s => s.since).filter(Boolean).sort()[0];
    const day = (t) => new Date(t).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
    const li = (k, v) => `<li><b>${esc(k)}</b><span>${v}</span></li>`;
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>AI 사용 기록</title><style>
@page{size:A4;margin:18mm 16mm}*{box-sizing:border-box}body{margin:0;font-family:Pretendard,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;color:#1f2933;font-size:11pt;line-height:1.55;word-break:keep-all}
h1{font-size:20pt;margin:0 0 4pt}.sub{color:#4a5560;margin:0 0 14pt}h2{font-size:12.5pt;margin:16pt 0 6pt;border-bottom:1px solid #d5dbe1;padding-bottom:3pt}
ul{list-style:none;padding:0;margin:0;display:grid;gap:4pt}li{display:grid;grid-template-columns:34mm 1fr;gap:8pt}li b{font-weight:600}
table{width:100%;border-collapse:collapse;font-size:10pt}th,td{text-align:left;vertical-align:top;padding:4pt 6pt;border-bottom:1px solid #e3e7eb}th{font-weight:600;background:#f3f5f7}td small{color:#4a5560}
.note{margin-top:14pt;font-size:9.5pt;color:#4a5560}</style></head><body>
<h1>AI 사용 기록</h1><p class="sub">${esc(title ?? "이 작업")} · 디냅스에서 만듦${since ? ` · ${day(since)}부터` : ""} · ${day(Date.now())} 기준</p>
<h2>요약</h2><ul>
${li("쓴 도구", tools.size ? [...tools].map(([k, n]) => `${esc(k)} ${n}회`).join(" · ") : "없음")}
${li("모델", models.size ? esc([...models].join(" · ")) : "—")}
${li("AI가 한 일", `편집 ${write}회 · 검토 ${review}회 · 받아들인 문장 제안 ${polish}회 · 되돌리기 ${restore}회${secs ? ` · 걸린 시간 합계 약 ${Math.max(1, Math.round(secs / 60))}분` : ""}`)}
${li("내 글 그대로", vb?.strict ? "켬 — AI는 문장을 바꾸지 않고 배치만 했어요(검사로 확인)" : "꺼짐 — AI가 장에 맞게 글을 다듬을 수 있었어요")}
${share !== null ? li("내가 쓴 글", `장 글의 약 ${share}%가 내가 쓴 문장 그대로예요`) : ""}
${li("사진 출처", photo.size ? [...photo].map(([k, n]) => `${esc(k)} ${n}장`).join(" · ") : "사진 없음")}
${li("레이아웃", forms.length ? esc(forms.slice(0, 12).join(" · ")) + (forms.length > 12 ? ` 외 ${forms.length - 12}` : "") : "디냅스 레이아웃에서 고름")}
${choices.length ? li("모양 고름", `${choices.length}곳에서 두 안 중 하나를 골랐어요(${choices.filter(c => c.by === "user").length}곳은 직접)`) : ""}
</ul>
<h2>차례별 기록</h2><table><thead><tr><th>차례</th><th>종류</th><th>도구 · 모델</th><th>바뀐 장</th><th>걸린 시간</th></tr></thead><tbody>
${rows.join("\n") || `<tr><td colspan="5">기록 없음</td></tr>`}
</tbody></table>
<p class="note">이 기록에는 내가 쓴 요청·원고와 AI의 답이 들어 있지 않아요. 쓴 도구·범위·시간·출처만 적었어요. 공개 라이선스 사진의 작가·라이선스는 마무리 장의 출처 줄에 있어요.</p>
</body></html>`;
}
