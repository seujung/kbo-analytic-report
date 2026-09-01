"""
네이버 스포츠 KBO 투구별 데이터 수집기
======================================
사용법:
    pip install requests pandas
    python naver_kbo_collect.py 2026-08-30              # 단일 날짜
    python naver_kbo_collect.py 2026-08-01 2026-08-30   # 날짜 범위

동작:
    1. 날짜별 KBO 경기 일정 조회 (종료된 경기만 수집)
    2. 경기마다 이닝별로 문자중계 요청 (?inning=N)
    3. 투구 텍스트 정보(구종/구속/결과)와 트래킹 데이터(ptsOptions)를
       pitchNum <-> ballcount 로 조인
    4. 경기별 CSV 저장:
       - output/{날짜}/{gameId}_pitches.csv   : 투구 단위 상세 데이터
       - output/{날짜}/{gameId}_text.csv      : 문자중계 전체 텍스트
       - output/{날짜}/{gameId}_raw.json      : 원본 JSON (백업)

주의: 비공식 API이므로 개인 연구 목적으로만 사용하고,
      요청 간격을 두어 서버에 부하를 주지 않도록 합니다.
"""

import sys
import json
import time
import random
from datetime import date, timedelta
from pathlib import Path

import requests
import pandas as pd

BASE = "https://api-gw.sports.naver.com"
OUTPUT_DIR = Path("output")
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Referer": "https://m.sports.naver.com/",
}

# 요청 간격 (서버 부하 방지)
INNING_DELAY = (0.5, 1.0)   # 이닝 요청 사이
GAME_DELAY = (2.0, 3.5)     # 경기 사이

# 투구 트래킹(pts) 필드 중 CSV에 저장할 항목
PTS_FIELDS = [
    "pitchId", "ballcount", "crossPlateX", "crossPlateY",
    "topSz", "bottomSz", "x0", "y0", "z0",
    "vx0", "vy0", "vz0", "ax", "ay", "az", "stance",
]


def get_json(path: str) -> dict:
    resp = requests.get(f"{BASE}{path}", headers=HEADERS, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success"):
        raise RuntimeError(f"API 오류: {str(data)[:200]}")
    return data["result"]


def update_player_map(relay: dict, player_map: dict[str, str]):
    """relay 응답의 엔트리/라인업에서 선수코드(pcode) -> 이름 매핑을 누적."""
    for side in ("homeEntry", "awayEntry", "homeLineup", "awayLineup"):
        group = relay.get(side) or {}
        for role in ("batter", "pitcher"):
            for p in (group.get(role) or []):
                pcode = str(p.get("pcode") or "").strip()
                name = (p.get("name") or "").strip()
                if pcode and name:
                    player_map[pcode] = name


def fetch_schedule(day: str) -> list[dict]:
    result = get_json(
        f"/schedule/games?upperCategoryId=kbaseball&fromDate={day}&toDate={day}"
    )
    return [g for g in result.get("games", []) if g.get("categoryId") == "kbo"]


def fetch_relay_all_innings(game_id: str) -> tuple[list[dict], dict[str, str], dict]:
    """모든 이닝의 textRelays 블록과 선수코드->이름 매핑을 수집.
    (블록 리스트, 선수 매핑, 첫 원본응답) 반환."""
    player_map: dict[str, str] = {}

    # 1차 호출: 마지막 이닝 번호 파악
    first = get_json(f"/schedule/games/{game_id}/relay")
    relay = first.get("textRelayData")
    if relay is None:
        return [], player_map, first

    update_player_map(relay, player_map)
    last_inn = int(relay.get("inn") or 0)
    blocks: dict[int, dict] = {}  # no -> block (중복 제거)
    for b in relay.get("textRelays", []):
        blocks[b["no"]] = b

    # 이닝별 호출 (1회 ~ 마지막 이닝)
    param_works = None  # inning 파라미터 동작 여부
    for inn in range(1, last_inn + 1):
        time.sleep(random.uniform(*INNING_DELAY))
        try:
            r = get_json(f"/schedule/games/{game_id}/relay?inning={inn}")
        except Exception as e:
            print(f"    [!] {inn}회 요청 실패: {e}")
            continue
        rd = r.get("textRelayData")
        if rd is None:
            continue
        update_player_map(rd, player_map)
        got = rd.get("textRelays", [])
        # inning 파라미터가 실제로 동작하는지 확인 (요청 이닝의 블록이 왔는지)
        inns_in_response = {b.get("inn") for b in got}
        if param_works is None:
            param_works = inn in inns_in_response or int(rd.get("inn") or -1) == inn
            if not param_works:
                print("    [!] ?inning= 파라미터가 동작하지 않는 것으로 보입니다.")
                print("        마지막 이닝 데이터만 수집됩니다. raw.json을 확인해 주세요.")
                break
        for b in got:
            blocks[b["no"]] = b
        print(f"    - {inn}회: 블록 {len(got)}개 (누적 {len(blocks)}개)")

    ordered = [blocks[k] for k in sorted(blocks.keys())]
    return ordered, player_map, first


def flatten_game(game_id: str, game_meta: dict, blocks: list[dict],
                 player_map: dict[str, str]):
    """textRelays 블록들을 투구 단위 / 텍스트 단위 행으로 평탄화."""
    pitch_rows = []
    text_rows = []

    for block in blocks:
        inn = block.get("inn")
        half = "초" if str(block.get("homeOrAway")) in ("0", "away") else "말"
        atbat_no = block.get("no")

        # pts 데이터: ballcount -> pts dict
        pts_map = {}
        for p in (block.get("ptsOptions") or []):
            if p.get("ballcount") is not None:
                pts_map[p["ballcount"]] = p

        # 타석 내 최신 상황(타자/투수) 추적
        batter = pitcher = None
        for opt in (block.get("textOptions") or []):
            gs = opt.get("currentGameState") or {}
            if gs.get("batter"):
                batter = gs["batter"]
            if gs.get("pitcher"):
                pitcher = gs["pitcher"]

            # 전체 텍스트 로그
            text_rows.append({
                "gameId": game_id,
                "inn": inn,
                "half": half,
                "atbat_no": atbat_no,
                "seqno": opt.get("seqno"),
                "type": opt.get("type"),
                "text": opt.get("text"),
            })

            # 투구(type==1)만 투구 테이블에 추가
            if opt.get("type") == 1 and opt.get("pitchNum") is not None:
                pitcher_id = str(gs.get("pitcher") or pitcher or "")
                batter_id = str(gs.get("batter") or batter or "")
                row = {
                    "gameId": game_id,
                    "date": game_meta.get("gameDate") or game_id[:8],
                    "away": game_meta.get("awayTeamName"),
                    "home": game_meta.get("homeTeamName"),
                    "inn": inn,
                    "half": half,
                    "atbat_no": atbat_no,
                    "pitcher_id": pitcher_id,
                    "pitcher_name": player_map.get(pitcher_id, ""),
                    "batter_id": batter_id,
                    "batter_name": player_map.get(batter_id, ""),
                    "pitchNum": opt.get("pitchNum"),
                    "stuff": opt.get("stuff"),        # 구종
                    "speed": opt.get("speed"),        # 구속 km/h
                    "pitchResult": opt.get("pitchResult"),  # B/S/T/F/H
                    "ball": gs.get("ball"),
                    "strike": gs.get("strike"),
                    "out": gs.get("out"),
                    "base1": gs.get("base1"),
                    "base2": gs.get("base2"),
                    "base3": gs.get("base3"),
                    "text": opt.get("text"),
                }
                # 트래킹 데이터 조인 (pitchNum <-> ballcount)
                pts = pts_map.get(opt["pitchNum"], {})
                for f in PTS_FIELDS:
                    row[f] = pts.get(f)
                pitch_rows.append(row)

    return pitch_rows, text_rows


def collect_game(game: dict, day_dir: Path) -> bool:
    game_id = game["gameId"]
    print(f"  [*] {game_id}: {game.get('awayTeamName')} vs {game.get('homeTeamName')}")

    blocks, player_map, raw = fetch_relay_all_innings(game_id)
    if not blocks:
        print("    [X] 중계 데이터 없음")
        return False

    pitch_rows, text_rows = flatten_game(game_id, game, blocks, player_map)

    day_dir.mkdir(parents=True, exist_ok=True)
    # 원본 백업
    (day_dir / f"{game_id}_raw.json").write_text(
        json.dumps(raw, ensure_ascii=False), encoding="utf-8"
    )
    # CSV 저장
    pd.DataFrame(pitch_rows).to_csv(
        day_dir / f"{game_id}_pitches.csv", index=False, encoding="utf-8-sig"
    )
    pd.DataFrame(text_rows).to_csv(
        day_dir / f"{game_id}_text.csv", index=False, encoding="utf-8-sig"
    )
    # 선수 ID-이름 매핑도 저장 (검증/재사용용)
    pd.DataFrame(
        [{"player_id": k, "player_name": v} for k, v in sorted(player_map.items())]
    ).to_csv(day_dir / f"{game_id}_players.csv", index=False, encoding="utf-8-sig")

    unmapped = {r["pitcher_id"] for r in pitch_rows} | {r["batter_id"] for r in pitch_rows}
    unmapped = {u for u in unmapped if u and u not in player_map}
    if unmapped:
        print(f"    [!] 이름을 찾지 못한 선수 ID {len(unmapped)}명: {sorted(unmapped)[:5]}...")
    innings = sorted({r["inn"] for r in pitch_rows if r["inn"]})
    print(f"    [+] 투구 {len(pitch_rows)}건 저장 "
          f"(이닝: {innings[0] if innings else '?'}~{innings[-1] if innings else '?'}, "
          f"타석 블록 {len(blocks)}개)")
    return True


def date_range(start: str, end: str):
    d0 = date.fromisoformat(start)
    d1 = date.fromisoformat(end)
    d = d0
    while d <= d1:
        yield d.isoformat()
        d += timedelta(days=1)


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    start = args[0]
    end = args[1] if len(args) > 1 else args[0]

    total_ok = total_games = 0
    for day in date_range(start, end):
        print(f"\n=== {day} ===")
        try:
            games = fetch_schedule(day)
        except Exception as e:
            print(f"  [X] 일정 조회 실패: {e}")
            continue

        finished = [g for g in games if g.get("statusCode") == "RESULT"]
        skipped = len(games) - len(finished)
        if skipped:
            print(f"  [i] 종료되지 않은 경기 {skipped}개는 건너뜁니다.")
        if not finished:
            print("  [i] 수집할 종료 경기가 없습니다.")
            continue

        day_dir = OUTPUT_DIR / day
        for i, g in enumerate(finished):
            total_games += 1
            if collect_game(g, day_dir):
                total_ok += 1
            if i < len(finished) - 1:
                time.sleep(random.uniform(*GAME_DELAY))

    print(f"\n완료: {total_ok}/{total_games} 경기 수집 성공")
    print(f"결과 위치: {OUTPUT_DIR.resolve()}")


if __name__ == "__main__":
    main()