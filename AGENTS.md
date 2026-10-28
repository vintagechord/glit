<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 온사이드 UI 색상 원칙

- 사용자 선호: 파스텔 색상은 사용하지 않는다. 상태 표시와 강조 요소는 온사이드의 선명한 바우하우스 팔레트(노랑·파랑·빨강·초록), 검정 테두리, 충분한 글자 대비를 유지한다. 기존 종이색·흰색·검정의 기본 바탕과 방송국 공식 로고는 유지한다.

## 운영 연동 보류사항

- 2026-10-27 사용자 요청: 이번 심의·아티스트·방송 가이드 변경은 운영에 적용한다. Spotify 및 YouTube API 키 발급·등록·활성화 작업은 나중으로 미룬다. 사용자가 재개를 요청하기 전에는 키 설정을 진행하지 않는다. 키 없이 가능한 기능은 정상 배포하고, 두 제공처는 기존 설정 필요 안내와 공식 사이트 연결을 유지한다.
- 구현 및 운영 반영 기록: `docs/onside-review-workflow-update.md`.
