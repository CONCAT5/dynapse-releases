// Tauri updater 서명(minisign) 검증 — 앱의 tauri-plugin-updater와 같은 규칙을 Node 표준 crypto로.
// 형식(실측, tauri-cli 2.11.5): pubkey/.sig 모두 "minisign 텍스트 파일"의 base64.
//   pubkey 줄: "Ed" + keyId(8) + ed25519 공개키(32)
//   sig 줄:    "ED"(BLAKE2b-512 선해시) 또는 "Ed" + keyId(8) + 서명(64)
//   trusted comment: "timestamp:…\tfile:…\tversion:x.y.z"  ← 전역 서명이 이 줄까지 보호
import { createHash, createPublicKey, verify } from "node:crypto";

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
const lines = (b64) => Buffer.from(b64.trim(), "base64").toString("utf8").split("\n").map(l => l.trim()).filter(Boolean);

export function decodePubkey(b64) {
  const raw = Buffer.from(lines(b64).find(l => !l.startsWith("untrusted comment:")), "base64");
  if (raw.length !== 42 || raw.subarray(0, 2).toString() !== "Ed") throw new Error("pubkey 형식이 minisign Ed25519가 아님");
  return { keyId: raw.subarray(2, 10), key: createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw.subarray(10)]), format: "der", type: "spki" }) };
}

export function decodeSignature(b64) {
  const ls = lines(b64);
  const i = ls.findIndex(l => l.startsWith("trusted comment:"));
  if (i < 1 || !ls[i + 1]) throw new Error("서명에 trusted comment/전역 서명이 없음");
  const raw = Buffer.from(ls[i - 1], "base64");
  const alg = raw.subarray(0, 2).toString();
  if (raw.length !== 74 || (alg !== "ED" && alg !== "Ed")) throw new Error("서명 형식이 minisign이 아님");
  const trusted = ls[i].slice("trusted comment:".length).trim();
  return { alg, keyId: raw.subarray(2, 10), sig: raw.subarray(10), trusted, global: Buffer.from(ls[i + 1], "base64") };
}

export const signedVersion = (trusted) =>
  trusted.split("\t").map(kv => kv.split(":")).find(([k]) => k === "version")?.slice(1).join(":") ?? null;

// 반환: { version } — 실패 시 throw. announcedVersion을 주면 서명된 버전과 일치해야 한다(앱의 requireSignedVersion과 같음).
export function verifyArtifact(data, signatureB64, pubkeyB64, announcedVersion) {
  const pk = decodePubkey(pubkeyB64);
  const s = decodeSignature(signatureB64);
  if (!pk.keyId.equals(s.keyId)) throw new Error("서명 키 ID가 pubkey와 다름 — 다른 키로 서명됨");
  const msg = s.alg === "ED" ? createHash("blake2b512").update(data).digest() : data;
  if (!verify(null, msg, pk.key, s.sig)) throw new Error("파일 서명 검증 실패");
  if (!verify(null, Buffer.concat([s.sig, Buffer.from(s.trusted, "utf8")]), pk.key, s.global))
    throw new Error("trusted comment 전역 서명 검증 실패");
  const version = signedVersion(s.trusted);
  if (!version) throw new Error("서명에 version이 없음 — requireSignedVersion 앱이 거부한다");
  if (announcedVersion && version.replace(/^v/, "") !== announcedVersion.replace(/^v/, ""))
    throw new Error(`서명된 버전 ${version} ≠ 매니페스트 버전 ${announcedVersion}`);
  return { version };
}
