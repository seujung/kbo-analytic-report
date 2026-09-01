"""
Statiz 경기 로그(gamelogs) 크롤러
=================================
사용법:
    # (최초 1회) 로그인 세션 저장 - 브라우저 창이 뜨면 직접 로그인 후 Enter
    python statiz_gamelog_crawler.py --login

    # 단일 경기
    python statiz_gamelog_crawler.py 20260593

    # 여러 경기 (범위)
    python statiz_gamelog_crawler.py 20260590 20260600

결과는 ./output/ 폴더에 경기별 CSV로 저장됩니다.
로그인 세션은 ./statiz_session.json 에 저장되어 재사용됩니다.
(비밀번호는 저장되지 않으며, 로그인 후의 쿠키만 저장됩니다)

필요 패키지:
    pip install requests beautifulsoup4 pandas lxml
    # requests로 안 될 경우 (JS 렌더링 페이지):
    pip install playwright
    playwright install chromium
"""

import sys
import time
import random
from pathlib import Path
from io import StringIO

import requests
import pandas as pd
from bs4 import BeautifulSoup

BASE_URL = "https://www.statiz.co.kr/schedule/"
OUTPUT_DIR = Path("output")
SESSION_FILE = Path("statiz_session.json")  # 로그인 쿠키 저장 파일

# 봇 차단 회피를 위한 브라우저 헤더
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Referer": "https://www.statiz.co.kr/",
    "Connection": "keep-alive",
}


def save_login_session():
    """브라우저 창을 띄워 사용자가 직접 로그인하게 한 뒤, 세션(쿠키)을 파일로 저장."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[!] playwright가 필요합니다:")
        print("    pip install playwright && playwright install chromium")
        sys.exit(1)

    print("[*] 브라우저 창이 열립니다. Statiz에 로그인해 주세요.")
    print("    로그인이 완료되면 이 터미널로 돌아와 Enter를 누르세요.")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(user_agent=HEADERS["User-Agent"])
        page = context.new_page()
        page.goto("https://www.statiz.co.kr/", timeout=60000)
        input("\n>>> 로그인 완료 후 Enter를 누르세요... ")
        context.storage_state(path=str(SESSION_FILE))
        browser.close()
    print(f"[+] 로그인 세션이 {SESSION_FILE}에 저장되었습니다.")
    print("    이제 크롤링을 실행하면 이 세션이 자동으로 사용됩니다.")


def fetch_with_requests(s_no: str) -> str | None:
    """requests로 HTML 가져오기. 저장된 세션 쿠키가 있으면 함께 사용."""
    url = f"{BASE_URL}?m=gamelogs&s_no={s_no}"
    cookies = {}
    if SESSION_FILE.exists():
        import json
        state = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
        for ck in state.get("cookies", []):
            if "statiz" in ck.get("domain", ""):
                cookies[ck["name"]] = ck["value"]
    try:
        resp = requests.get(url, headers=HEADERS, cookies=cookies, timeout=15)
        resp.raise_for_status()
        # 테이블이 실제로 존재하는지 간단히 확인
        if "<table" in resp.text:
            return resp.text
        print(f"  [!] {s_no}: requests 응답에 테이블 없음 (로그인 필요 또는 JS 렌더링)")
        return None
    except requests.RequestException as e:
        print(f"  [!] {s_no}: requests 실패 - {e}")
        return None


def fetch_with_playwright(s_no: str) -> str | None:
    """Playwright(헤드리스 브라우저)로 JS 렌더링 후 HTML 가져오기."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  [!] playwright가 설치되어 있지 않습니다.")
        print("      pip install playwright && playwright install chromium")
        return None

    url = f"{BASE_URL}?m=gamelogs&s_no={s_no}"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            # 저장된 로그인 세션이 있으면 불러오기
            if SESSION_FILE.exists():
                context = browser.new_context(
                    user_agent=HEADERS["User-Agent"],
                    storage_state=str(SESSION_FILE),
                )
            else:
                context = browser.new_context(user_agent=HEADERS["User-Agent"])
            page = context.new_page()
            # networkidle은 광고/트래커 때문에 타임아웃되기 쉬움 -> domcontentloaded 사용
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            # 테이블 로딩 대기 (최대 20초)
            try:
                page.wait_for_selector("table", timeout=20000)
            except Exception:
                print(f"  [!] {s_no}: 20초 내에 테이블이 나타나지 않음")
            html = page.content()
            browser.close()
            return html
    except Exception as e:
        print(f"  [!] {s_no}: playwright 실패 - {e}")
        return None


def parse_gamelogs(html: str, s_no: str) -> dict[str, pd.DataFrame]:
    """페이지 내 모든 테이블을 파싱해서 {테이블명: DataFrame} 딕셔너리로 반환."""
    soup = BeautifulSoup(html, "lxml")
    tables = soup.find_all("table")
    if not tables:
        return {}

    result = {}
    for i, table in enumerate(tables):
        # 테이블 이름 추정: 직전 제목 요소(h1~h4, caption 등)에서 가져오기
        name = None
        caption = table.find("caption")
        if caption and caption.get_text(strip=True):
            name = caption.get_text(strip=True)
        else:
            # 바로 인접한 앞 요소만 확인 (다른 테이블의 제목을 물려받지 않도록)
            prev = table.find_previous_sibling()  # 필터 없이 = 바로 앞 형제
            if prev is not None and prev.name in ("h1", "h2", "h3", "h4", "div", "p"):
                text = prev.get_text(strip=True)
                if 0 < len(text) < 30:
                    name = text
        if not name:
            name = f"table_{i+1}"

        # 파일명에 못 쓰는 문자 제거
        safe_name = "".join(c if c.isalnum() or c in " _-" else "_" for c in name).strip()

        try:
            df = pd.read_html(StringIO(str(table)))[0]
            # 중복 이름 처리
            key = safe_name
            n = 2
            while key in result:
                key = f"{safe_name}_{n}"
                n += 1
            result[key] = df
        except ValueError:
            continue

    return result


def crawl_game(s_no: str) -> bool:
    """경기 하나를 크롤링해서 CSV로 저장. 성공 여부 반환."""
    print(f"[*] 경기 {s_no} 크롤링 중...")

    html = fetch_with_requests(s_no)
    if html is None:
        print(f"  -> playwright로 재시도...")
        html = fetch_with_playwright(s_no)
    if html is None:
        print(f"  [X] {s_no}: 페이지를 가져오지 못했습니다.")
        return False

    tables = parse_gamelogs(html, s_no)
    if not tables:
        print(f"  [X] {s_no}: 파싱된 테이블이 없습니다.")
        # 디버깅용으로 HTML 저장
        debug_path = OUTPUT_DIR / f"{s_no}_debug.html"
        debug_path.write_text(html, encoding="utf-8")
        print(f"      (원본 HTML을 {debug_path}에 저장했으니 구조를 확인해 보세요)")
        return False

    game_dir = OUTPUT_DIR / s_no
    game_dir.mkdir(parents=True, exist_ok=True)
    for name, df in tables.items():
        path = game_dir / f"{name}.csv"
        df.to_csv(path, index=False, encoding="utf-8-sig")  # 엑셀 호환
        print(f"  [+] 저장: {path} ({len(df)}행)")
    return True


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)

    if args[0] == "--login":
        save_login_session()
        return

    if not SESSION_FILE.exists():
        print("[i] 저장된 로그인 세션이 없습니다. 로그인이 필요한 페이지라면 먼저 실행하세요:")
        print("    python statiz_gamelog_crawler.py --login\n")

    OUTPUT_DIR.mkdir(exist_ok=True)

    if len(args) == 1:
        s_nos = [args[0]]
    else:
        start, end = int(args[0]), int(args[1])
        s_nos = [str(n) for n in range(start, end + 1)]

    success = 0
    for i, s_no in enumerate(s_nos):
        if crawl_game(s_no):
            success += 1
        # 서버 부하 방지를 위한 딜레이 (여러 경기일 때)
        if i < len(s_nos) - 1:
            time.sleep(random.uniform(1.5, 3.0))

    print(f"\n완료: {success}/{len(s_nos)} 경기 성공")


if __name__ == "__main__":
    main()