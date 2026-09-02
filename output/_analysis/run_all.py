# -*- coding: utf-8 -*-
"""분석 집계 5단계(agg.py → agg2 → agg3 → agg4 → agg5)를 순서대로 한 번에 실행합니다.

사용법:
  python output/_analysis/run_all.py                 # 5단계 전체 실행
  python output/_analysis/run_all.py --skip-cache    # agg.py(전처리) 생략, 기존 df_cache.pkl 재사용
  python output/_analysis/run_all.py --build         # 집계 후 site/build.py 로 docs/index.html 재빌드
  python output/_analysis/run_all.py --build --public  # 빌드 시 API 키 미포함 (push 전 필수)

어느 디렉터리에서 실행해도 됩니다. 중간 단계가 실패하면 즉시 중단하고 종료 코드 1을 반환합니다.
"""
import os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))              # output/_analysis
REPO = os.path.dirname(os.path.dirname(HERE))                   # 저장소 루트
BUILD = os.path.join(REPO, "site", "build.py")

STEPS = [
    ("agg.py",  "전 경기 로드 + 공통 전처리 → df_cache.pkl"),
    ("agg2.py", "선수별 구종×존 집계        → aggregate.json"),
    ("agg3.py", "투수×타자 상대 전적         → matchups.json"),
    ("agg4.py", "투수별 투구 패턴            → patterns.json"),
    ("agg5.py", "선수·리그 월별 집계          → monthly.json"),
]

def main(argv):
    skip_cache = "--skip-cache" in argv
    do_build   = "--build" in argv
    public     = "--public" in argv
    unknown = [a for a in argv if a not in ("--skip-cache", "--build", "--public")]
    if unknown:
        print("알 수 없는 옵션:", *unknown); print(__doc__); return 2
    if public and not do_build:
        print("--public 은 --build 와 함께 사용합니다."); return 2

    steps = STEPS[1:] if skip_cache else STEPS
    if skip_cache and not os.path.exists(os.path.join(HERE, "df_cache.pkl")):
        print("df_cache.pkl 이 없어 --skip-cache 를 적용할 수 없습니다. agg.py 부터 실행합니다.")
        steps = STEPS

    t_all = time.time()
    for i, (script, desc) in enumerate(steps, 1):
        print(f"\n[{i}/{len(steps)}] {script} — {desc}", flush=True)
        t = time.time()
        rc = subprocess.call([sys.executable, os.path.join(HERE, script)])
        if rc != 0:
            print(f"\n✗ {script} 실패 (종료 코드 {rc}) — 이후 단계를 중단합니다.")
            return 1
        print(f"    ✓ {time.time() - t:.1f}s")

    if do_build:
        cmd = [sys.executable, BUILD] + (["--public"] if public else [])
        print(f"\n[build] site/build.py{' --public' if public else ''} — docs/index.html 재빌드", flush=True)
        t = time.time()
        rc = subprocess.call(cmd, cwd=REPO)
        if rc != 0:
            print(f"\n✗ build.py 실패 (종료 코드 {rc})"); return 1
        print(f"    ✓ {time.time() - t:.1f}s")

    print(f"\n완료 — 총 {time.time() - t_all:.1f}s")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
