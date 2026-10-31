# 온사이드 Supabase 일일 백업

Supabase 무료 플랜은 자동 백업이 없으므로, 운영자 Mac이 매일 04:40(KST)에
`onside-supabase-backup.mjs`를 실행한다(launchd `kr.onside.supabase-backup`).

| 대상 | 방식 | 위치 |
| --- | --- | --- |
| DB 전체(public·auth·storage 메타·cron 등) | `pg_dump --format=custom`, `pg_restore --list`·행 수 검증, 14일 보관 | `~/OnsideBackups/db/<날짜_시각>/onside-full.dump` |
| Supabase Storage(배너·매거진 이미지 등) | 파일 단위 미러, 원본에서 지워져도 로컬은 유지 | `~/OnsideBackups/storage/<버킷>/` |
| Backblaze B2(고객 음원·영상) | 파일 목록(키·크기·날짜·ETag)만 기록 | `~/OnsideBackups/db/<날짜_시각>/b2-inventory.json` |

결과는 `~/OnsideBackups/last-status.json`과 `logs/backup.log`에 남고, 실패하면 Mac
알림을 보낸다. 심의 데스크 **사이트 관리**에도 마지막 백업 시각이 표시된다.

## 최초 설정 (한 번만)

1. DB 비밀번호를 키체인에 저장한다. Supabase 대시보드 ▶ Project Settings ▶ Database
   ▶ Database password에서 확인하거나 재설정한다(앱은 API 키를 쓰므로 재설정해도
   서비스에는 영향이 없다).

   ```sh
   security add-generic-password -s onside-supabase-db -a postgres -w
   ```

   입력 프롬프트에 비밀번호를 붙여 넣는다. 비밀번호는 파일·명령줄에 남지 않는다.
2. 스케줄 등록: `node scripts/backup/install-backup-agent.mjs`
3. 즉시 한 번 실행해 확인: `launchctl kickstart gui/$(id -u)/kr.onside.supabase-backup`
   후 `cat ~/OnsideBackups/last-status.json`

Supabase·B2 API 키는 심의 데스크 운영 연결 파일
(`~/Library/Application Support/Onside Review Desk/connection.env`, 권한 600)에서 읽는다.

## 복원

새(또는 같은) Supabase 프로젝트의 연결 정보로 실행한다. 운영 DB에 바로 복원하지 말고
먼저 별도 프로젝트나 로컬 Postgres에서 확인한다.

```sh
/opt/homebrew/opt/libpq@17/bin/pg_restore --list ~/OnsideBackups/db/<날짜_시각>/onside-full.dump | head
/opt/homebrew/opt/libpq@17/bin/pg_restore --no-owner --no-privileges \
  -h <host> -U <user> -d postgres ~/OnsideBackups/db/<날짜_시각>/onside-full.dump
```

Storage 파일은 `storage/<버킷>/` 경로 그대로 같은 버킷에 다시 올린다. B2 파일은 B2에
그대로 있으며, 삭제 사고가 나면 `b2-inventory.json`으로 사라진 키를 확인한다.
