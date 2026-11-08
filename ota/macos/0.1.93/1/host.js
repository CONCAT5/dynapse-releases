const classic = {
    name: "classic",
    invoke: (cmd, args) => window.__TAURI__.core.invoke(cmd, args),
    invokeRaw: (cmd, body, o) => window.__TAURI__.core.invoke(cmd, body, o),
    openUrl: url => window.__TAURI__.shell.open(url),
};
let cur = classic;
// 바꿔 끼우기 — null이면 클래식으로
export function setHost(h) { cur = h ?? classic; }
// 보고에 싣는 호스트 이름(계획 §3 ⑤ host: classic|beta|shell)
export const hostName = () => cur.name;
export const host = {
    get name() { return cur.name; },
    invoke: (cmd, args) => cur.invoke(cmd, args),
    invokeRaw: (cmd, body, o) => cur.invokeRaw(cmd, body, o),
    openUrl: url => cur.openUrl(url),
};
