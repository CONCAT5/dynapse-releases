// 뒤에서 도는 일(#151 보정 2) — 턴 밖에서 도는 일(사진 묶음·늦은 교체·언어판 번역)을 작업마다 한 목록으로.
// 바뀌면 1.5초 모아 그 작업 대화에 상태 한 건(kind "bg", 글 없음 — 채팅 줄이 아니다). 웹이 상태 점 옆 한 줄·펼침으로 그리고, 멤버도 같은 것을 읽기 전용으로 본다.
// 서버 호출: 바뀔 때만(묶음 하나에 수 회 · 1.5초 안 변화는 한 번). 끝난 항목은 10분 남는다(웹이 until로 지운다 — 지우려고 다시 보내지 않는다)
import { postChat } from "./chat.js";
const works = new Map();
const timers = new Map();
const KEEP_MS = 10 * 60_000;
function flush(id) {
    timers.delete(id);
    const m = works.get(id);
    if (!m)
        return;
    const now = Date.now();
    for (const [k, it] of m)
        if (it.state === "done" && (it.until ?? 0) < now)
            m.delete(k);
    void postChat(id, [{ role: "event", text: null, payload: { kind: "bg", ai: "dynapse", at: now, items: [...m.values()].slice(0, 20) } }]).catch(() => { });
    if (!m.size)
        works.delete(id);
}
const later = (id) => { if (!timers.has(id))
    timers.set(id, setTimeout(() => flush(id), 1500)); };
// 줄은 28자까지(voice — 내부어 없음)
const cut = (t) => (t.length > 28 ? `${t.slice(0, 27)}…` : t);
export function bgSet(id, it) {
    const m = works.get(id) ?? works.set(id, new Map()).get(id);
    const prev = m.get(it.k);
    m.set(it.k, { ...it, text: cut(it.text), since: it.since ?? (prev && prev.state === it.state ? prev.since : Date.now()) });
    later(id);
}
export function bgDone(id, k, text) {
    const m = works.get(id), it = m?.get(k);
    if (!m || !it)
        return;
    m.set(k, { ...it, text: cut(text), state: "done", act: undefined, wait_gen: false, until: Date.now() + KEEP_MS });
    later(id);
}
export function bgDrop(id, k) { const m = works.get(id); if (m?.delete(k))
    later(id); }
export const bgItems = (id) => [...(works.get(id)?.values() ?? [])];
// 웹의 버튼(bg-act) — [멈춤]·[지금 교체]·[건너뛰기]. 동작은 그 일을 맡은 곳이 등록한다
const acts = new Map();
export function bgOnAct(id, k, f) { if (f)
    acts.set(`${id}|${k}`, f);
else
    acts.delete(`${id}|${k}`); }
export function bgAct(id, k, act) { acts.get(`${id}|${k}`)?.(act); }
