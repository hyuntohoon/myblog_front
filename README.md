# myblog_front

> **MyBlog + Music Review** 프로젝트의 프론트엔드 — Astro 기반 정적 사이트 + 관리자 글쓰기 UI

🔗 **전체 프로젝트 README:** [MyBlog + Music Review](https://github.com/hyuntohoon/myblog_front#관련-리포지토리)

---

## 개요

사용자에게 보여지는 블로그 정적 사이트와 관리자 글쓰기 화면을 담당합니다. Astro로 빌드된 정적 페이지는 S3에 배포되고 CloudFront를 통해 서빙됩니다.

---

## 주요 기능

**일반 사용자 (읽기)**

- 블로그 글 열람 — CloudFront 캐시 기반으로 빠른 응답
- 음악 검색 — DB-first 검색 UI, 필요 시 Sync 버튼으로 Spotify 최신 후보 확인
- 트랙 클릭 → 앨범 상세(DB) 이동

**관리자 (글쓰기)**

- Cognito 인증 후 글 작성 화면 진입
- 에디터에서 앨범·아티스트 검색 및 연결, 평점(0~10) 입력
- 글 저장 후 Publish API 호출로 정적 사이트 갱신 트리거

---

## 기술 스택

| 항목       | 기술                        |
| ---------- | --------------------------- |
| 프레임워크 | Astro                       |
| 배포       | S3 + CloudFront             |
| CI/CD      | GitHub Actions              |
| 인증       | AWS Cognito (관리자 글쓰기) |

---

## 서비스 연동

```
myblog_front
  ├── → myblog_backend   : 글/카테고리 CRUD (POST, GET /posts, /categories)
  ├── → myblog_music     : 음악 검색 (GET /search/unified, /search/candidates)
  └── → myblog_publish   : 글 발행 트리거 (POST /publish)
```

---

## 환경 변수

| 변수                      | 설명                      |
| ------------------------- | ------------------------- |
| `PUBLIC_API_URL`          | 공개 API URL (Music API)  |
| `PUBLIC_BACKEND_API_URL`  | 백엔드 API URL (Blog API) |
| `PUBLIC_PUBLISH_BASE_URL` | 퍼블리싱 트리거 URL       |

---

## 배포

GitHub Actions가 `main` 브랜치 push 시 자동으로 Astro 빌드 → S3 업로드 → CloudFront invalidation을 수행합니다.

---

## 왜 분리했는가

읽기 트래픽은 CDN 캐시로 대부분 처리되므로 프론트는 **정적·저비용·고가용**이 핵심입니다. UI/콘텐츠 변경 주기가 가장 빠른 영역이라 독립 배포가 필요했습니다.

---

## 관련 리포지토리

| 리포                                                             | 역할                          |
| ---------------------------------------------------------------- | ----------------------------- |
| **myblog_front** (현재)                                          | 정적 사이트 + 글쓰기 UI       |
| [`myblog_backend`](https://github.com/hyuntohoon/myblog_backend) | 글·카테고리 API + 인증        |
| [`myblog_music`](https://github.com/hyuntohoon/myblog_music)     | DB-first 검색 + Sync 트리거   |
| [`myblog_worker`](https://github.com/hyuntohoon/myblog_worker)   | SQS Consumer + Spotify 동기화 |
| [`myblog_publish`](https://github.com/hyuntohoon/myblog_publish) | 정적 사이트 발행              |
