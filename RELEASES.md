# 배포 원장

스크립트(publish·promote·rollback)만 줄을 추가한다. 손으로 고치지 않는다.

| 일시 (UTC) | 플랫폼 | 채널 | 버전 | 태그 | 결과 | 메모 |
|---|---|---|---|---|---|---|
| 2026-09-23T22:08:14.532Z | macos | beta | 0.1.0 | macos-v0.1.0 | beta-served-verified | 첫 베타 |
| 2026-09-23T22:10:04Z | macos | beta | 0.1.0 | macos-v0.1.0 | dmg-notarized-replaced | dmg가 공증 없이 올라가 Gatekeeper 거부 → notarytool 공증·staple 후 같은 Release의 dmg만 교체 (업데이트 피드 tar.gz는 그대로) |
