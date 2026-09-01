# KBO 나인존 리포트 (NineZone Report)

네이버 스포츠의 KBO 투구 추적 데이터를 수집하고, 9분할 스트라이크 존 기반 세이버메트릭스로
투수/타자를 분석하는 웹 리포트를 생성·배포하는 프로젝트입니다.

- **배포 (GitHub Pages):** https://seujung.github.io/kbo-analytic-report/ — 아래 [3단계](#3단계--github-pages-배포) 참고
- **Claude 아티팩트 (대안):** https://claude.ai/code/artifact/996926d2-66bb-4c06-9ea3-7b72c24f7ce7
- **탭 구성:** 투수 · 타자 (개인 리포트, 투수는 투구 패턴 분석 포함) / 리그 분석 (평균 대비 상위·하위, 구종 랭킹) / 가상 매칭 (상대 전적 + 대응 전략)
- **현재 집계 범위:** 2026-03-28 ~ 2026-08-30, 576경기, 177,347구 (투수 198명 · 타자 175명, 각 200구 이상)

## 저장소 구조

```
baseball/
├── naver_kbo_collect.py      # 1단계: 네이버 스포츠 투구별 데이터 수집기
├── log_crawler.py            # (보조) Statiz 경기 로그 크롤러 — 리포트 파이프라인 미사용
├── output/                   # 수집 결과 (날짜별 폴더, git 미추적 — 약 200MB)
│   ├── 2026-03-28/
│   │   ├── {gameId}_pitches.csv   # 투구 단위 상세 (구종·구속·결과·트래킹 좌표)
│   │   ├── {gameId}_text.csv      # 문자중계 전체 텍스트 (타석 결과 파싱용)
│   │   ├── {gameId}_players.csv   # 선수 ID-이름 매핑
│   │   └── {gameId}_raw.json      # 원본 JSON 백업
│   └── _analysis/            # 2단계: 분석 집계 (스크립트·결과 JSON은 git 추적)
│       ├── agg.py            # 공통 전처리 (존 판정, 타석 결과, RV) → df_cache.pkl
│       ├── agg2.py           # 선수별 집계 → aggregate.json
│       ├── agg3.py           # 상대 전적 집계 → matchups.json
│       ├── agg4.py           # 투구 패턴 집계 → patterns.json
│       └── agg5.py           # 월별 집계 → monthly.json
├── site/                     # 3단계: 리포트 페이지 템플릿 + 빌드 스크립트
│   ├── head.html             # <head> 내용 (타이틀·폰트·전체 CSS)
│   ├── body.html             # 페이지 마크업 (사이드바·메인 레이아웃)
│   ├── app.js                # 앱 로직 (JSON은 __DATA__ 등 플레이스홀더로 임베드)
│   ├── logos/                # 구단 로고 파일 (선택) — 빌드 시 자동 임베드
│   └── build.py              # 템플릿 + JSON(+로고) → docs/index.html 생성
├── docs/                     # GitHub Pages 배포 대상 (Settings에서 main /docs 지정)
│   ├── index.html            # 빌드된 단일 파일 리포트 (~1.6MB, 의존성 없음)
│   └── .nojekyll
├── .gitignore                # output 원본·세션 쿠키·캐시 제외
└── README.md
```

## 1단계 — 데이터 수집

`naver_kbo_collect.py`가 네이버 스포츠 API에서 날짜별 KBO 경기 일정을 조회하고,
종료된 경기의 이닝별 문자중계와 투구 트래킹 데이터(ptsOptions)를 받아
`output/{날짜}/` 아래 경기별 CSV로 저장합니다.

```bash
pip install requests pandas

python naver_kbo_collect.py 2026-08-30              # 단일 날짜
python naver_kbo_collect.py 2026-08-01 2026-08-30   # 날짜 범위
```

이미 수집된 날짜를 다시 실행해도 덮어쓸 뿐 문제는 없습니다.
비공식 API이므로 스크립트에 내장된 요청 간격(이닝 0.5~1초, 경기 2~3.5초)을 유지하고
개인 연구 목적으로만 사용하세요.

## 2단계 — 분석 집계

수집이 끝나면 `output/_analysis/`의 스크립트 4개를 **순서대로** 실행합니다.
경로는 스크립트 위치 기준이라 어느 디렉터리에서 실행해도 됩니다.

```bash
pip install pandas numpy

python output/_analysis/agg.py     # 전 경기 로드 + 공통 전처리 → df_cache.pkl (~5초)
python output/_analysis/agg2.py    # 선수별 구종×존 집계        → aggregate.json (~650KB)
python output/_analysis/agg3.py    # 투수×타자 상대 전적         → matchups.json  (~740KB)
python output/_analysis/agg4.py    # 투수별 투구 패턴            → patterns.json  (~120KB)
python output/_analysis/agg5.py    # 선수·리그 월별 집계          → monthly.json   (~80KB)
```

| 스크립트 | 하는 일 | 산출물 |
|---|---|---|
| `agg.py` | 전 경기 pitches/text CSV 로드, 궤적(z0·vz0·az)으로 플레이트 통과 높이 계산, 투구별 topSz/bottomSz를 3×3 등분해 9존 판정(+존 밖), text.csv(type 13/23)에서 타석 결과 파싱, wOBA 가중치·카운트별 기대득점(RV) 부여 | `df_cache.pkl` (중간 캐시) |
| `agg2.py` | 투수/타자별(200구 이상) 구종×존 집계, 리그 기준선, 백분위 | `aggregate.json` |
| `agg3.py` | 투수×타자 페어별 상대 전적 (타석 1회 이상) | `matchups.json` |
| `agg4.py` | 카운트별 구종 선택(12분류), 타석 내 구종 시퀀스 전이, 좌/우타자별 구사율 | `patterns.json` |
| `agg5.py` | 선수별·리그 월별 성적 (월별 흐름 카드, 월별 리그 트렌드에 사용) | `monthly.json` |

`agg2~5`는 `df_cache.pkl`을 읽으므로 새 경기를 수집했다면 반드시 `agg.py`부터 다시 실행합니다.

## 3단계 — GitHub Pages 배포

리포트는 집계 JSON 3개를 단일 HTML에 임베드한 정적 페이지입니다.
빌드 스크립트가 `docs/index.html`을 생성하고, GitHub Pages가 `docs/` 폴더를 그대로 서빙합니다.
서버·프레임워크·외부 의존성이 없습니다 (폰트만 Google Fonts 로드).

### 최초 1회 설정

이 저장소는 이미 `https://github.com/seujung/kbo-analytic-report` 에 연결되어 있으므로 푸시만 하면 됩니다.

```bash
cd ~/repo/kbo-analytic-report
git push origin dev        # 현재 브랜치(dev) 푸시
```

그다음 GitHub 저장소 페이지에서 **Settings → Pages → Build and deployment**:
- Source: **Deploy from a branch**
- Branch: **dev** (main으로 운영하려면 dev를 main에 병합 후 main 선택), 폴더: **/docs** → Save

1~2분 뒤 https://seujung.github.io/kbo-analytic-report/ 에서 리포트가 열립니다.
(비공개 저장소여도 Pages 사용은 가능하지만, Pages 사이트 자체는 공개됩니다.)

### 데이터 갱신 → 재배포 루틴

```bash
python naver_kbo_collect.py 2026-08-31          # ① 새 경기 수집
python output/_analysis/agg.py                  # ② 집계 (4개 순서대로)
python output/_analysis/agg2.py
python output/_analysis/agg3.py
python output/_analysis/agg4.py
python output/_analysis/agg5.py
python site/build.py                            # ③ docs/index.html 재빌드
git add output/_analysis/*.json docs/index.html # ④ 커밋 & 푸시 → 자동 재배포
git commit -m "데이터 갱신: ~2026-08-31"
git push origin dev
```

푸시 후 1~2분이면 Pages에 반영됩니다.
디자인·기능을 수정할 때는 `site/`의 템플릿을 고친 뒤 ③~④만 다시 하면 됩니다.

### 구단 로고 넣기 (선택)

`site/logos/` 폴더에 팀 이름으로 이미지 파일을 넣고 다시 빌드(③)하면 자동으로 페이지에 임베드됩니다.

- 파일명: 리포트의 팀 표기 그대로 — `KIA.png`, `두산.png`, `LG.png`, `삼성.jpg`, `SSG.png`, `롯데.png`, `NC.png`, `KT.png`, `키움.png`, `한화.png`
- 별칭도 인식: `엘지`→LG, `기아`→KIA, `엔씨`→NC, `케이티`→KT, `베어스`→두산, `트윈스`→LG, `라이온즈`→삼성 등
- png/jpg/webp/gif 지원, 빌드 시 96px로 리사이즈되어 용량 부담 없음 (Pillow 필요: `pip install pillow`)
- 파일이 없는 팀은 구단 브랜드 컬러 모노그램 배지로 표시됩니다

Claude 아티팩트 버전을 함께 쓰는 경우, 이 저장소가 연결된 Claude 세션에서
"나인존 리포트 아티팩트 업데이트해줘"라고 요청하면 같은 아티팩트 URL로 재게시됩니다.

## AI 분석 챗 (Google Gemini API)

리포트 우측 상단의 **AI 분석 챗** 버튼을 누르면 오른쪽에 챗 패널이 열리고,
현재 열람 중인 선수(가상 매칭이면 두 선수 + 상대전적)의 집계 데이터가 자동으로 컨텍스트에 포함되어
AI 모델과 대화할 수 있습니다. 엔드포인트는 Google Gemini API의 OpenAI 호환 모드(무료 티어, 브라우저 CORS 지원) 기준입니다.

설정 (택 1):

1. **로컬 빌드용** — 저장소 루트에 `.env` 파일 생성 후 재빌드 (`env.example` 참고):
   ```
   GLM_API_KEY=발급받은키               # https://aistudio.google.com/apikey 에서 무료 발급
   GLM_MODEL=gemini-2.5-flash         # 대안: gemini-2.5-flash-lite, gemma-3-27b-it (ai.google.dev/models)
   GLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
   ```
   `python site/build.py` 실행 시 키가 `docs/index.html`에 주입됩니다. **`.env`를 만들거나 수정한 뒤에는 반드시 재빌드해야 반영됩니다.** (`.env`가 있으면 페이지 ⚙ 설정보다 항상 우선합니다)
2. **배포 페이지용** — 챗 패널의 ⚙ 설정에서 키를 입력하면 해당 브라우저(localStorage)에만 저장됩니다.

주의사항:

- **`.env`에 키를 넣고 빌드한 `docs/index.html`에는 키가 그대로 들어갑니다. git push 전에는 반드시 `python site/build.py --public` 으로 재빌드해서 키 없는 버전을 커밋하세요.** `.env` 자체는 `.gitignore`에 포함되어 커밋되지 않습니다.
- 무료 티어는 분당/일일 요청 한도가 있습니다(ai.google.dev/pricing). 한도 초과(429) 시 자동 재시도하며, 실패하면 원인별 안내가 표시됩니다 (401/403 키 오류, 404 모델 ID 오류 등).

## 지표 정의 (근사값)

- **9분할 존** — 각 투구에 기록된 개인별 스트라이크 존 상·하한(topSz/bottomSz)을 3×3 등분, 포수 시점(왼쪽=3루측). 존 밖은 별도 집계
- **pitchResult 코드** — B 볼 / T 루킹 / S 헛스윙 / F 파울 / H 인플레이 / W 번트파울 / V 번트헛스윙
- **wOBA 가중치** — BB .69, HBP .72, 1루타 .88, 2루타 1.25, 3루타 1.58, HR 2.03
- **RV/100** — 카운트 전이 기대득점 + 타석 결과 선형 가중치를 100구당 환산 (타자 관점, 투수는 음수가 유리)
- **투수 좌/우완** — 릴리스 x0 좌표 중앙값으로 추정 (데이터에 투수 손 정보 없음)
- **가상 매칭 우위 판정** — 구종별 (리그 wOBA − 투수 피wOBA) + (리그 wOBA − 타자 wOBA) + 0.35×헛스윙 편차, ±0.045 기준
- **투구 패턴** — 카운트는 투구 직전 기준, 시퀀스는 같은 타석 내 직전→다음 구종(행 정규화), 20구 미만 구종 제외
- **구단 배지** — 공식 로고가 아닌 구단 브랜드 컬러 기반 모노그램

## 주의사항

- **`statiz_session.json`(로그인 쿠키)은 절대 커밋하지 마세요.** `.gitignore`에 포함되어 있지만, 실수로 `git add -f` 하지 않도록 주의하세요.
- GitHub Pages에 배포하면 **집계 JSON과 리포트가 공개**됩니다(비공개 저장소여도 Pages 사이트 자체는 공개). 수집 데이터는 비공식 API 기반이므로 개인 연구 범위를 벗어난 공개·배포에 유의하세요.
- 수집 원본(`output/` 날짜 폴더, 약 200MB)과 `df_cache.pkl`(약 48MB)은 `.gitignore`로 제외되어 저장소에 올라가지 않습니다. 원본 보존이 필요하면 별도 백업을 권장합니다.
- wOBA 가중치와 카운트별 기대득점은 MLB 기반 일반 근사값으로, KBO 정밀 계수와는 차이가 있을 수 있습니다.
- 타구 속도/발사각 데이터가 없어 타구 질 평가는 결과 기반(wOBA/BABIP)으로만 이루어집니다.
