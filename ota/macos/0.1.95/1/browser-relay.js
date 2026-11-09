export const RELAY_WINDOW_MS = 10 * 60_000;
// 로그인 제공자 — 이 도메인의 코드는 어느 사이트를 위해서도 중계하지 않는다(피싱: "구글 코드를 넣으라"). 제외 사이트(#75-2 은행 · 카드 · 증권 · 세무 · 정부 · 병원)는 네이티브 민감 분류(sensitive)로 받는다
const ID_PROVIDERS = new Set(["google.com", "gmail.com", "youtube.com", "apple.com", "icloud.com", "microsoft.com", "live.com", "outlook.com", "hotmail.com", "kakao.com", "kakaocorp.com", "naver.com", "facebook.com", "facebookmail.com", "meta.com", "instagram.com", "amazon.com", "github.com", "x.com", "twitter.com", "line.me", "yahoo.com"]);
const TWO_LEVEL = /\.(co|or|go|ac|ne|re|pe)\.(kr|jp)$|\.(com|co|net|org|gov|ac)\.(uk|au|cn|tw|sg|br|in)$/;
// 등록 도메인(대략) — 메일 보낸 곳과 사이트를 같은 회사로 볼 때만 쓴다
export function siteDomain(hostOrUrl) {
    const h = hostOrUrl.toLowerCase().trim().replace(/^[a-z]+:\/\//, "").replace(/[:/?#].*$/, "").replace(/\.$/, "");
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h))
        return h;
    return h.split(".").slice(TWO_LEVEL.test(h) ? -3 : -2).join(".");
}
const mailDomain = (addr) => siteDomain((addr.match(/@([A-Za-z0-9.-]+)/)?.[1] ?? "").toLowerCase());
export const isIdProvider = (hostOrUrl) => ID_PROVIDERS.has(siteDomain(hostOrUrl));
// 코드 후보 — 4~8자리 숫자 또는 숫자가 섞인 대문자 영숫자, "인증 · 확인 · verification · code" 근처(앞뒤 60자)만. 전화 · 가격 · 시각 · 날짜 · 연도는 뺀다
const NEAR = /(인증|확인|보안|verification|verify|confirm|security|one[- ]?time|otp|passcode|code|코드|번호)/i;
export function extractCodes(text) {
    const t = text.replace(/\s+/g, " "), out = new Set();
    for (const m of t.matchAll(/(?<![\w@./:$₩-])((?=[A-Z0-9]*\d)[A-Z0-9]{4,8})(?![\w@:-])/g)) {
        const code = m[1], i = m.index ?? 0, after = t.slice(i + code.length, i + code.length + 4), before = t.slice(Math.max(0, i - 3), i);
        if (/^\s*(원|₩|달러|won|krw|usd|%|시|분|초|년|월|일)/i.test(after) || /[$₩]\s*$/.test(before))
            continue;
        if (/^(19|20)\d{2}$/.test(code) && /^\s*[.년-]/.test(after))
            continue;
        if (!NEAR.test(t.slice(Math.max(0, i - 60), i + code.length + 60)))
            continue;
        out.add(code);
    }
    return [...out];
}
const VERIFY_LINK = /(verify|verification|confirm|activate|magic|인증|확인)/i;
// 판단 — 차례가 중요하다: 제외 · 메일함 없음 · 메일함 바뀜 → 보낸 곳이 그 사이트인 메일 → 10분 안 → 하나만 → 코드 하나만
export function relayDecide(o) {
    if (o.sensitive || isIdProvider(o.site))
        return { state: "blocked" };
    if (o.mailbox === "none")
        return { state: "no_mail" };
    if (o.mailbox === "changed")
        return { state: "mail_changed" };
    const site = siteDomain(o.site), screen = o.screenSender && !isIdProvider(mailDomain(o.screenSender)) ? o.screenSender.toLowerCase() : null;
    const mine = o.mails.filter(m => { const d = mailDomain(m.from); return !!d && !ID_PROVIDERS.has(d) && (d === site || (!!screen && m.from.toLowerCase().includes(screen))); });
    if (!mine.length)
        return { state: "none" };
    const fresh = mine.filter(m => o.now - m.at <= RELAY_WINDOW_MS && m.at <= o.now + 60_000);
    if (!fresh.length)
        return { state: "stale" };
    if (fresh.length > 1)
        return { state: "multiple" };
    const m = fresh[0], codes = extractCodes(m.text), ageMin = Math.max(0, Math.round((o.now - m.at) / 60_000));
    if (codes.length === 1)
        return { state: "found", code: codes[0], ageMin };
    if (!codes.length && (m.links ?? []).some(l => VERIFY_LINK.test(l)))
        return { state: "link", ageMin };
    return { state: "none", why: codes.length > 1 ? "ambiguous_code" : "no_code", ageMin };
}
// 기록(#86) — 결과 · 사이트 · 시각 · 메일 나이만. 코드 · 메일 제목 · 보낸 사람 · 본문은 없다
export function relayRecord(site, r, at, by = "app") {
    return { result: by === "person" ? "typed" : r.state, site: siteDomain(site), at, ...(typeof r.ageMin === "number" ? { mail_age_min: r.ageMin } : {}), ...(r.why ? { why: r.why } : {}) };
}
// -81 §1-21 문안 그대로(#83 동의 카드 · #84 성공 띠 · #85 인계 일곱 키 · #86 기록 줄). 조사는 사이트 이름 끝소리로
function has(w) { const c = w.trim().slice(-1), code = c.charCodeAt(0); if (code >= 0xac00 && code <= 0xd7a3)
    return (code - 0xac00) % 28 > 0; return "lmnkprt".includes(c.toLowerCase()) || "0136".includes(c); }
const ga = (w) => `${w}${has(w) ? "이" : "가"}`, eun = (w) => `${w}${has(w) ? "은" : "는"}`;
export const RELAY = {
    consent: (site, mailbox = "Gmail") => ({ head: `${site} 인증 코드를 메일에서 찾아 넣을까요?`, body: [`로그인된 ${mailbox}에서 ${ga(site)} 10분 안에 보낸 메일의 코드만 찾아 ${site} 인증 칸에 넣어요`, "AI는 코드와 메일 내용을 보지 않아요 · 코드와 메일 내용은 기록하지 않아요"], note: `허용하면 다음부터 ${eun(site)} 묻지 않고 넣어요 · 연결에서 끌 수 있어요`, actions: ["relay-allow", "relay-manual"] }),
    done: (site) => ({ text: `${site} 인증 코드를 메일에서 찾아 넣었어요 · 메일 내용은 남기지 않아요`, actions: ["stop"] }),
    handoff: (key, site) => ({ text: {
            none: `${ga(site)} 보낸 인증 메일을 찾지 못했어요 · 코드를 직접 넣어 주세요`,
            multiple: `${site} 인증 메일이 둘 이상 와 있어서 넣지 않았어요 · 맞는 코드를 직접 넣어 주세요`,
            stale: `${site} 인증 메일이 10분 넘게 지나서 넣지 않았어요 · 새 코드를 받아 직접 넣어 주세요`,
            link: `${site} 인증 메일이 링크로 왔어요 · 메일에서 링크를 직접 눌러 주세요`,
            blocked: `${site} 인증은 직접 해 주세요 · AI는 하지 않아요`,
            no_mail: "로그인된 메일함이 없어서 찾지 못했어요 · 코드를 직접 넣어 주세요",
            mail_changed: "메일함 로그인이 바뀐 것으로 보여서 찾지 않았어요 · 코드를 직접 넣어 주세요",
        }[key], key: `relay_${key}`, actions: ["manual", "stop"] }),
    log: (site, time, by) => `${site} 인증 코드 · ${time} · ${by === "app" ? "넣음" : "직접"}`,
};
