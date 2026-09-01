#!/usr/bin/env python3
"""나인존 리포트 정적 페이지 빌드
site/의 템플릿(head.html, body.html, app.js)에 output/_analysis/의 집계 JSON을
임베드하여 docs/index.html (GitHub Pages 배포 대상)을 생성합니다.

사용법:  python site/build.py
선행조건: output/_analysis/aggregate.json · matchups.json · patterns.json
          (agg.py → agg2.py → agg3.py → agg4.py 실행 결과)
"""
from pathlib import Path

BASE = Path(__file__).resolve().parent      # site/
ROOT = BASE.parent                          # 저장소 루트
A = ROOT / "output" / "_analysis"

head = (BASE / "head.html").read_text(encoding="utf-8")
body = (BASE / "body.html").read_text(encoding="utf-8")
app  = (BASE / "app.js").read_text(encoding="utf-8")

for ph, fn in [("__DATA__", "aggregate.json"), ("__MATCH__", "matchups.json"), ("__PATTERN__", "patterns.json")]:
    data = (A / fn).read_text(encoding="utf-8")
    assert ph in app, f"플레이스홀더 {ph} 없음"
    assert "</script" not in data.lower(), f"{fn}에 위험 문자열 포함"
    app = app.replace(ph, data)

page = (
    '<!doctype html>\n<html lang="ko">\n<head>\n'
    '<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + head +
    '\n</head>\n<body>\n' + body + '\n<script>\n' + app + '\n</script>\n</body>\n</html>\n'
)

out = ROOT / "docs" / "index.html"
out.parent.mkdir(exist_ok=True)
out.write_text(page, encoding="utf-8")
print(f"built {out} ({out.stat().st_size:,} bytes)")
