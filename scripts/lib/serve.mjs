// 서빙 검증 — "올렸다"가 아니라 "Pages가 내보내는 것을 받아 서명까지 확인했다"가 완료 기준 (§0-4, §4-7)
import { feedUrl, manifestErrors, sleep } from "./common.mjs";
import { verifyArtifact } from "./minisign.mjs";

async function getJson(url) {
  const r = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store", redirect: "follow" });
  if (r.status !== 200) throw new Error(`${url} → HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) throw new Error(`${url}: UTF-8 BOM`);
  return JSON.parse(buf.toString("utf8"));
}

// expectVersion이 서빙될 때까지 최대 timeoutMin 분 폴링 → 서빙된 url·signature로 asset 전체를 받아 검증
export async function verifyServed(c, platform, channel, expectVersion, { timeoutMin = 15, log = console.log } = {}) {
  const url = feedUrl(c, platform, channel);
  const deadline = Date.now() + timeoutMin * 60_000;
  let m = null, last = "";
  for (;;) {
    try {
      m = await getJson(url);
      if (!expectVersion || m.version === expectVersion) break;
      last = `서빙 중 version ${m.version} (기다리는 값 ${expectVersion})`;
    } catch (e) { last = e.message; }
    if (Date.now() > deadline) throw new Error(`${timeoutMin}분 안에 ${url} 가 ${expectVersion} 을 서빙하지 않음 — ${last}. Pages 빌드 상태: gh api repos/${c.owner}/${c.repo}/pages/builds/latest`);
    log(`  … ${last}`);
    await sleep(30_000);
  }
  const errs = manifestErrors(m, platform, c);
  if (errs.length) throw new Error(`서빙된 매니페스트 오류:\n  - ${errs.join("\n  - ")}`);
  const seen = new Map();
  for (const [key, p] of Object.entries(m.platforms)) {
    if (!seen.has(p.url)) {
      const r = await fetch(p.url, { redirect: "follow" }); // 302만 보고 성공 처리하지 않는다 [사고 5]
      if (r.status !== 200) throw new Error(`${key}: asset ${p.url} → 최종 HTTP ${r.status}`);
      seen.set(p.url, Buffer.from(await r.arrayBuffer()));
    }
    verifyArtifact(seen.get(p.url), p.signature, c.pubkey, m.version);
    log(`  ✓ ${key}: 서명·버전(${m.version}) 검증 (${seen.get(p.url).length} bytes)`);
  }
  return m;
}
