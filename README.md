# 네이버 카페 아카이빙 (Ncafescraper)

네이버 카페에서 **내가 열람 가능한 게시글**을 조건 기반으로 찾아서,
**본문 전체 텍스트 + 댓글 전체 텍스트**를 Google Sheets로 아카이빙하는 프로젝트입니다.

이 문서는 “인수인계용”입니다. 다음 개발자가 그대로 이어서 고칠 수 있도록 **현재 구조/운영 URL/환경변수/디버깅 방법/미해결 이슈**를 정리했습니다.
기능/배포/운영에 변경이 있으면 이 문서를 같이 업데이트합니다.

## 0.1) 현재 운영 URL (2026-02 기준)

- Web (Vercel Production): `https://ncafescraper-sigma.vercel.app`
  - 배포 확인: `GET /api/version`
  - 환경변수 확인(민감정보 미출력): `GET /api/env-check`
  - 워커 하트비트: `GET /api/worker-status` (로그인 필요)

주의:
- 도메인은 바뀔 수 있습니다. 최종 “프로덕션 도메인”은 Vercel 프로젝트의 Production Domain을 기준으로 합니다.

## 0) 핵심 요구사항(현재 구현 기준)

- 입력: 선택한 카페들 + 키워드 목록(쉼표 구분, 공백 자동 제거)
- 동작:
  - **카페 A에서 키워드 a,b,c...를 각각 검색 → 조건 맞는 글을 수집**
  - **카페 B에서도 동일하게 반복**
  - 검색은 페이지당 50개(`size=50`), **키워드당 최대 4페이지(=최대 200개 후보)까지 스캔**
- 저장:
  - DB(PostgreSQL): 원문/댓글 텍스트를 최대한 보존
  - Google Sheets: `posts_v2` 시트(웹훅)로 전송
- 진행상황:
  - 웹에서 `카페 x 키워드 진행표`로 `후보/수집/스킵/필터` + `페이지 x/4` 표시
- 실행 정책:
  - 웹에서 작업 등록(수동)
  - Worker(Railway)가 24시간 큐를 처리(PC 꺼도 진행)

## 1) 전체 아키텍처

- Web(UI): **Vercel**
  - Next.js(App Router)
  - 작업 생성/조회/중단, 세션(storageState) 업로드
  - 진행표(UI)는 DB에 기록된 progress를 폴링해서 렌더
- Worker: **Railway**
  - Node 프로세스 1개(`npm run worker`)
  - DB에서 `QUEUED` 작업을 가져와 순차 실행
  - Playwright로 카페 글/댓글 파싱
- DB: **Neon PostgreSQL**
  - Vercel/Worker가 **동일한 DATABASE_URL**을 사용해야 함
- Sheets: **Google Apps Script Web App**
  - `GSHEET_WEBHOOK_URL`로 POST 전송
  - `posts_v2` 시트에 append

## 2) 데이터 흐름(파이프라인)

1. 웹(UI)에서 작업 생성
   - 선택 카페 수만큼 **작업을 카페별로 분할 생성**(1카페 = 1 job)
2. Worker(Railway)가 큐에서 `QUEUED` job pick → `RUNNING`
3. 키워드별 검색
   - Naver 내부 검색 API(모바일)로 후보 글 목록을 가져옴
   - `perPage=50`, 키워드당 최대 4페이지 스캔
4. 후보 글 파싱
   - 게시글 페이지 접속 → 본문 텍스트/댓글 텍스트 추출
   - 열람 불가(가입/등업/권한) 페이지는 스킵 처리
5. 저장/연동
   - DB에 저장(게시글/댓글)
   - Google Sheets 웹훅으로 전송(시트는 `posts_v2`만 사용)
6. 진행상황 업데이트
   - DB `Setting.key = scrapeJobProgress:<jobId>`에 progress JSON 저장
   - 웹은 이 progress를 폴링해서 표를 갱신

## 3) 저장 포맷(Google Sheets: posts_v2)

웹훅 payload는 아래 키로 전송합니다:
- `postRowsV2`: 배열

각 row 필드:
- `jobId`
- `sourceUrl` (게시글 링크)
- `cafeId` (예: `mom79`)
- `cafeName` (예: `초등맘 (초중고 부모들의 목소리)`)
- `cafeUrl` (카페 링크)
- `title`
- `authorName` (현재는 비워질 수 있음; 필요없다면 제거 가능)
- `publishedAt` (ISO string)
- `viewCount`, `likeCount`, `commentCount`
- `bodyText` (본문 전체 텍스트)
- `commentsText` (댓글 전체 텍스트)
- `contentText` (본문+댓글을 합친 텍스트)

주의:
- Sheets는 셀 글자수 제한이 있어 `src/lib/sheets.ts`에서 긴 텍스트를 잘라서 보냅니다(원문 전체는 DB에 남김).

## 4) 환경변수(필수)
 
Vercel과 Railway 모두 아래는 **동일하게 설정**:
 
- `DATABASE_URL`
  - Neon Postgres 접속 문자열
  - Web/Worker가 서로 다른 DB를 보면 “진행표가 안 뜸 / 작업이 따로 도는” 현상이 발생합니다.
- `APP_AUTH_SECRET` (16자 이상)
  - **중요**: Web(Vercel)과 Worker(Railway)의 값이 다르면 **"Unsupported state"** 에러가 발생하며 작업이 실패합니다.
  - 반드시 **Shared Variable** 기능 등을 사용하여 두 서비스가 동일한 값을 참조하도록 하세요.
- `GSHEET_WEBHOOK_URL`
  - Apps Script Web App URL
  - *Note*: 2026-02-16 업데이트로 코드(`src/lib/sheets.ts`) 내에 기본 URL이 하드코딩되었습니다. 환경변수가 없으면 기본값을 사용합니다.
 
옵션:
- `APP_LOGIN_ID`, `APP_LOGIN_PASSWORD`: 로그인용
- Telegram 토큰 등
 
## 4.1) 배포 및 운영 가이드 (2026-02-16 업데이트)
 
### Worker 배포 (Railway)
- **Dockerfile 기반 배포**: `Dockerfile`이 프로젝트 루트에 있으며, `mcr.microsoft.com/playwright:v1.49.0-jammy` 이미지를 기반으로 합니다.
- **Playwright 설치**: Docker 이미지에 브라우저가 포함되어 있어 별도의 `npx playwright install` 과정이 필요 없습니다. (빌드 속도 향상 및 오류 방지)
- **주의**: `package.json`에 `postinstall` 스크립트가 있으면 Docker 빌드 시점에서 `prisma generate` 오류가 날 수 있어 제거되었습니다.
 
### Google Sheet 연동
- **시트 이름**: `posts_v2` (앱스크립트가 자동 생성)
- **데이터**: 제목 또는 본문에 키워드가 포함되면 수집됨 (API `searchBy=1` 모드 사용)
- **디버깅**: Worker 로그에 `sheetSynced: N`이 뜨는지 확인하세요. `GSHEET_WEBHOOK_URL`이 없으면 전송 시도조차 하지 않습니다.

## 5) 세션(storageState) 준비(가장 중요)

Worker가 네이버에 로그인된 상태로 접근하려면 **Playwright storageState(JSON)** 가 필요합니다.

### 5.1) 세션 생성(로컬 1회)

프로젝트 폴더 이름은 환경마다 다를 수 있습니다(예: `naver-bc-automation`, `Ncafescraper` 등).
중요한 건 **`package.json`이 있는 폴더**에서 실행하는 것입니다.

1. 로컬(내 PC/Mac)에서 프로젝트 폴더로 이동
```bash
cd "<프로젝트폴더>"
ls package.json
```

2. 의존성/브라우저 설치(최초 1회)
```bash
npm install
npx playwright install chromium
```

3. 로그인 세션 생성
```bash
npm run cafe:login
```

4. 생성된 파일 확인(상대경로)
- `playwright/storage/naver-cafe-session.json`

5. (Mac) 파일 내용을 클립보드로 복사(선택)
```bash
cat playwright/storage/naver-cafe-session.json | pbcopy
```

6. 웹 대시보드의 `1) 카페 세션 확인`에서 JSON 전체를 붙여넣고 저장

### 5.2) 세션 저장 실패/주의

- `APP_AUTH_SECRET`가 없거나 Vercel/Railway 값이 서로 다르면:
  - 세션 저장 자체가 실패하거나,
  - 저장은 되더라도 Worker가 복호화 실패로 로그인 상태 접근을 못합니다.
- storageState(JSON)에는 로그인 쿠키가 포함됩니다. **절대 채팅/이슈에 그대로 붙여넣지 말고** 웹 입력칸에만 붙여넣습니다.

## 6) 로컬 실행(개발/디버깅)

웹(UI):
```bash
cd "/Users/leesungjun/Documents/New project/naver-bc-automation"
npm run dev
```

Worker(로컬에서 큐 처리):
```bash
cd "/Users/leesungjun/Documents/New project/naver-bc-automation"
npm run worker
```

특정 jobId만 실행(디버깅):
```bash
cd "/Users/leesungjun/Documents/New project/naver-bc-automation"
npm run scrape:job -- <jobId>
```

카페 검색 API 디버그:
```bash
cd "/Users/leesungjun/Documents/New project/naver-bc-automation"
npm run debug:cafe-search -- "https://cafe.naver.com/f-e/cafes/<clubid>/menus/0?viewType=L&ta=ARTICLE_COMMENT&page=1&q=%EC%A7%91%EC%A4%91&size=50"
```

## 7) “페이지 1/4”가 웹에서 안 보일 때 체크리스트

1. Vercel이 최신 코드인지 확인
   - 대시보드 상단에 `WEB <sha>`가 표시됩니다.
   - 또는 API로 확인: `GET /api/version`
   - env 체크: `GET /api/env-check` (DB가 깨져도 true/false는 확인 가능)
2. Railway Worker가 실제로 돌고 있는지 확인
   - 대시보드 상단에 `WORKER <sha>` + “worker n초 전”이 표시됩니다.
   - `GET /api/worker-status`가 `null`이면 Worker가 DB에 heartbeat를 못 쓰는 상태입니다.
3. Web과 Worker의 `DATABASE_URL`이 같은지 확인
   - 다르면: 작업 생성은 되는데 진행표/페이지 카운트가 영원히 `-`로 보이거나, 큐가 안 움직입니다.
4. Worker가 진행값(progress)을 쓰는지 확인
   - DB `Setting.key = scrapeJobProgress:<jobId>` row가 있어야 합니다.
   - API로도 확인 가능: `GET /api/scrape-jobs/<jobId>/progress`

추가(중요):
- 브라우저 팝업에 `Environment variable not found: DATABASE_URL`가 뜨면:
  - Vercel 환경변수에 `DATABASE_URL`이 없거나,
  - Production/Preview 환경을 잘못 넣었거나,
  - **다른 프로젝트/다른 배포 도메인을 보고 있는 상태**입니다.
- `DATABASE_URL_`(언더스코어) 관련 오류가 뜨면:
  - 이 repo 기준 Prisma는 `DATABASE_URL`만 사용합니다.
  - 보통 “옛날 배포/다른 코드”를 보고 있을 확률이 높으니, `GET /api/version`과 `GET /api/env-check`로 현재 배포를 확정하세요.

## 8) Railway가 GitHub 자동배포(자동 Deploy)인지 확인하는 방법

Railway 콘솔에서:
1. Project 선택 → 해당 Service(Worker) 선택
2. `Deployments` 또는 `Settings > Source` 메뉴 확인
3. 아래가 보이면 GitHub 연동 상태입니다:
   - 연결된 GitHub repo/branch
   - “Push 할 때 자동 Deploy” 옵션(자동 배포 토글)
   - 최근 배포 히스토리(커밋 SHA)

연동이 안 되어 있으면:
- “Connect Repo / Deploy from GitHub” 같은 버튼으로 연결해야 합니다.

## 9) 미해결/리스크(다음 작업자가 바로 봐야 함)

- 수집량이 기대보다 적은 문제
  - “검색 후보가 적어서”인지, “필터/권한/파싱 실패로 스킵”인지 분해/가시화가 아직 부족합니다.
  - 목표: keyword x cafe마다 `후보/수집/스킵/필터`에 “왜 스킵됐는지” 주요 이유를 추가로 집계 표기.
- 카페별/게시판별 권한(가입/등업) 때문에 **검색은 되지만 본문/댓글 파싱이 막히는 글**이 존재함.
  - 현재는 이런 페이지를 감지하면 스킵 처리합니다.
- 네이버 UI/DOM 변경에 취약
  - 본문/댓글 파서는 구조 변경에 따라 깨질 수 있습니다.
- 속도/안정성
  - 키워드가 많고 카페가 많으면 시간이 오래 걸립니다(Worker는 순차 실행).
  - 너무 공격적으로 돌리면 차단/레이트리밋 가능성이 있으므로, sleep/재시도는 보수적으로 유지 중.
- “정말 최대 4페이지를 봤는지” 검증
  - Worker는 progress에 `pagesScanned/pagesTarget`를 기록하도록 되어 있습니다.
  - 웹에서 페이지 라인이 안 보이면, 대체로 “Vercel/Worker 코드 불일치(배포 stale)” 또는 “DB 불일치” 입니다.

## 10) 주요 파일(인수인계용)

- 웹 UI: `src/app/page.tsx`
- 작업 생성 API: `src/app/api/scrape-jobs/route.ts`
- progress 조회 API: `src/app/api/scrape-jobs/[id]/progress/route.ts`
- 버전 API: `src/app/api/version/route.ts`
- env 체크 API: `src/app/api/env-check/route.ts`
- 워커 상태 API: `src/app/api/worker-status/route.ts`
- Worker 큐: `scripts/queue-worker.ts`
- Worker 스크래퍼: `scripts/scrape-job.ts`
- Prisma 스키마: `prisma/schema.prisma`
- Sheets 전송: `src/lib/sheets.ts`
