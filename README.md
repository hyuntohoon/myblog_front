# myblog_front

> **MyBlog + Music Review** 프로젝트의 프론트엔드 — Astro 기반 정적 사이트 + 멤버(회원) 서피스 + 오너 글쓰기 UI

🔗 **전체 프로젝트 README:** [MyBlog + Music Review](https://github.com/hyuntohoon/myblog_front#관련-리포지토리)

---

## 개요

공개 정적 사이트(에디토리얼·카탈로그·회원 프로필)와 멤버 기능(가입·평가·버킷·연동·설정), 오너 글쓰기 화면을 담당합니다. Astro로 빌드된 정적 페이지는 S3에 배포되고 CloudFront를 통해 서빙됩니다.

---

## 주요 기능

**일반 사용자 (읽기)**

- 블로그 글 열람 — CloudFront 캐시 기반으로 빠른 응답
- 음악 검색 — DB-first 검색 UI, 필요 시 Sync 버튼으로 Spotify 최신 후보 확인
- 트랙 클릭 → 앨범 상세(DB) 이동

**회원 (Google/Kakao 가입, FEAT-multi-user-accounts)**

- 로그인 팝오버(카카오/Google/이메일) → Cognito PKCE; 로그인 후 원래 보던 페이지로 복귀 (returnTo)
- 앨범 오버레이에서 0.5 단위 평가+코멘트 (`AlbumRatingBlock`, 비로그인 시 로그인 CTA)
- 회원 서피스 `/members/` — 디렉터리(평가한 회원), `?u=<handle>` 런타임 프로필(배포 불필요), `?me` 본인; 정적 `/members/[handle]` 은 SEO 프리빌드. 본인 확인 시 SelfDashboard 탭(개요·평론·My Buckit·분석 버킷·연동)
- `/settings/` — 핸들·표시명 편집, Last.fm/Spotify 연동, 계정 삭제; `/privacy` 개인정보처리방침
- 공개 컬렉션 `/collection` — 회원들이 공개로 설정한 버킷, 소유자 귀속(@handle) 표시

**오너 (글쓰기)**

- Cognito 인증 후 글 작성 화면 진입 (`/write`, `/drafts`) — 오너 전용 (`isOwnerUser()` UI 게이트 + 서버 `require_owner`)
- 에디터에서 앨범·아티스트 검색 및 연결, 평점(0~5, 0.5 단위) 입력, 임시저장/발행/아카이브/복원/삭제
- 오너의 대시보드도 회원과 같은 `/members/?me` 서피스(개요·평론·My Buckit·분석 버킷·연동)에서 제공

---

## 기술 스택

| 항목       | 기술                        |
| ---------- | --------------------------- |
| 프레임워크 | Astro 5 + React 19 (island) |
| 배포       | S3 + CloudFront             |
| CI/CD      | GitHub Actions              |
| 인증       | AWS Cognito (회원 로그인 — Google/Kakao IdP + 이메일; 오너 글쓰기) |
| 타입 계약  | `docs/contracts/openapi.json` → `pnpm generate:types` → `src/lib/api.gen.ts` |

---

## 서비스 연동

```
myblog_front
  ├── → myblog_backend   : 글/카테고리 CRUD + 발행 (POST /api/publish)
  └── → myblog_music     : 음악 검색 (GET /api/music/search/{unified,candidates})
```

> 옛 `myblog_publish` 서비스는 ARCH-11 으로 backend 에 흡수되었음. `/api/publish` 는 이제 backend 에서 직접 처리.

---

## 환경 변수

| 변수                      | 설명                                       |
| ------------------------- | ------------------------------------------ |
| `PUBLIC_API_URL`          | Music API 베이스 URL                       |
| `PUBLIC_BACKEND_API_URL`  | Backend API 베이스 URL (글/카테고리/발행)  |

---

## 배포

GitHub Actions가 `main` 브랜치 push 시 자동으로 Astro 빌드 → S3 업로드 → CloudFront invalidation을 수행합니다.

---

## 왜 분리했는가

읽기 트래픽은 CDN 캐시로 대부분 처리되므로 프론트는 **정적·저비용·고가용**이 핵심입니다. UI/콘텐츠 변경 주기가 가장 빠른 영역이라 독립 배포가 필요했습니다.

---

## 관련 리포지토리

| 리포                                                                   | 역할                                  |
| ---------------------------------------------------------------------- | ------------------------------------- |
| **myblog_front** (현재)                                                | 정적 사이트 + 글쓰기 UI               |
| [`myblog_backend`](https://github.com/hyuntohoon/myblog_backend)       | 글·카테고리 API + 인증 + 발행         |
| [`myblog_music`](https://github.com/hyuntohoon/myblog_music)           | DB-first 검색 + Sync 트리거           |
| [`myblog_worker`](https://github.com/hyuntohoon/myblog_worker)         | SQS Consumer + Spotify 동기화         |
| [`myblog_shared_db`](https://github.com/hyuntohoon/myblog_shared_db)   | 공유 SQLAlchemy 모델 (git-pinned)     |

> 옛 `myblog_publish` 서비스는 ARCH-11 으로 backend 에 흡수되었고 업스트림은 archived 됨.
