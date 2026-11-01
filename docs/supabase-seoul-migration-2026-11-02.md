# Supabase Mumbai → Seoul 이전 기록 (2026-11-02)

온사이드 Supabase를 뭄바이(`rwysjsmxtpuqekeltwxi`, ap-south-1)에서 서울(`ggpkzttyfkopcdctvxzz`, ap-northeast-2, 프로젝트명 `onside`)로 옮기고, Vercel 서버 함수도 `bom1`에서 `icn1`로 옮겼다. Supabase는 리전 변경 기능이 없어 새 프로젝트를 만들어 이전했다.

## 결과
- 사이트·API·크론·메일 중계·심의 데스크·일일 백업이 모두 서울 프로젝트를 쓴다.
- 함수 리전 `icn1::icn1`. 따뜻한 상태의 API 응답이 200~250ms에서 70~110ms로 줄었다.
- 조직은 무료 요금제(계정당 활성 무료 프로젝트 2개)라, 이전하는 동안 `iamfine`을 일시정지했다. 뭄바이 프로젝트를 일시정지한 뒤 다시 켠다.

## 옮긴 방법
1. **DB**: 일일 백업(`pg_dump --format=custom`)에서 필요한 항목만 골라 복원했다. 복원은 한 트랜잭션으로 실행하고, 인증 테이블 외래키가 이미 있어 `session_replication_role = replica`를 썼다.
   - 공개 스키마 전체(테이블·함수·정책·트리거·데이터)
   - 인증: users / identities / custom_oauth_providers(Naver)
   - 스토리지: buckets와 storage.objects 정책 7개
   - supabase_migrations 이력
2. **권한 맞춤 (중요)**:
   - 새 프로젝트는 기본 권한 때문에 새로 만든 테이블·함수에 anon/authenticated 권한을 자동으로 준다. pg_dump는 회수(REVOKE)를 기록하지 않아, 복원 직후에는 기존에 막아 둔 권한이 다시 열려 있었다.
   - 기존 DB에서 `aclexplode`로 객체별 정확한 REVOKE+GRANT(열 권한 3개 포함)를 뽑아 적용했고, 1,849개 권한 지문이 원본과 같은지 확인했다.
   - **다시 복원할 일이 있으면 이 단계를 반드시 반복한다.**
3. **스토리지**: 파일 41개(6,984,498B)를 경로·형식·캐시 설정 그대로 복사했다. `ad_banners.image_url`은 새 주소로 바꿨다.
4. **Edge Function**: `send-transactional-email`을 배포하고 SMTP 설정과 새 중계 비밀값을 넣었다. `SMTP_PASS`는 사장님이 입력했다.
5. **인증 설정**: 관리 API로 site URL, 허용 리디렉트, 수동 계정 연결, Google·Kakao 클라이언트 ID를 복사했다.
   - 관리 API는 제공자 비밀키를 해시로만 돌려줘서, Google·Kakao 비밀키는 사장님이 다시 입력했다.
   - Supabase 기본 메일 템플릿은 쓰지 않으므로(인증 메일은 앱이 직접 보냄) 새 기본값을 유지했다.
6. **전환**:
   - 데이터 차이 확인: 시각 칸만 달랐다.
   - Vercel 운영 환경변수 5개 교체: Supabase URL, anon, service role, 중계 URL, 중계 비밀값
   - PR #62 병합: `icn1`, 주소를 환경변수에서 계산
   - 크론 4개를 서울에 등록하고 뭄바이에서 제거
   - 데스크 연결 파일, 백업 키체인, `.env.local`, CLI 링크 교체
7. **로그인 제공자 콜백**: Google·Kakao·Naver 세 곳 모두 `https://ggpkzttyfkopcdctvxzz.supabase.co/auth/v1/callback`이다.

## 남은 일
- 사장님이 Google·Kakao·Naver·이메일 로그인을 한 번씩 실제로 확인한다. 비밀키는 실제 로그인으로만 검증된다.
- 뭄바이 프로젝트를 일시정지(삭제 아님)해 되돌릴 수 있는 사본으로 두고, `iamfine`을 다시 켠다.
