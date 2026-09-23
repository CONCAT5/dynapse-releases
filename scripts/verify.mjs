#!/usr/bin/env node
// 서빙 검증만 단독 실행 (§4-7) — 언제든: node scripts/verify.mjs --platform macos --channel latest|beta [--version x.y.z]
import { arg, platformArg, die, loadConfig } from "./lib/common.mjs";
import { verifyServed } from "./lib/serve.mjs";

const platform = platformArg();
const channel = arg("channel", "latest");
if (!["latest", "beta"].includes(channel)) die("--channel latest|beta");
const version = typeof arg("version") === "string" ? arg("version") : null;
try {
  const m = await verifyServed(loadConfig(), platform, channel, version, { timeoutMin: version ? 15 : 0 });
  console.log(`✓ ${platform}/${channel}.json ${m.version} 서빙·서명 정상`);
} catch (e) { die(e.message); }
