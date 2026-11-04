export const EXEMPLAR_FILE = ".dynapse/exemplar.html", EXEMPLAR_META = ".dynapse/exemplar.json";
export const EXEMPLAR_LINE = "[Exemplar: .dynapse/exemplar.html is one verified Dynapse page — match its level of finish and its density (layers, image area); never copy its text, numbers or photos; the structure is yours.]\n";
export function pickExemplar(items, o) {
    const kind = /^card/.test(o.frame) ? "card" : "slide";
    let c = items.filter(x => x.kind === kind && x.review?.status !== "no" && !(x.relation ?? []).some(r => r.startsWith("role:")));
    if (o.recent.length) {
        const r = c.filter(x => !o.recent.includes(x.id));
        if (r.length)
            c = r;
    }
    const m = o.mood.toLowerCase(), hit = m ? c.filter(x => (x.mood ?? []).some(k => m.includes(k.toLowerCase()) || k.toLowerCase().includes(m))) : [];
    if (hit.length)
        c = hit;
    const lv = (x) => x.density?.level ?? 0, top = Math.max(0, ...c.map(lv)), pool = c.filter(x => lv(x) === top);
    if (!pool.length)
        return null;
    const h = [...o.seed].reduce((a, ch) => (Math.imul(a, 31) + ch.charCodeAt(0)) >>> 0, 7), it = pool[h % pool.length];
    return { id: it.id, variant: !o.hasPhotos && (it.photo?.slots ?? 0) > 0 && it.photo?.nophoto_variant ? "nophoto" : null };
}
