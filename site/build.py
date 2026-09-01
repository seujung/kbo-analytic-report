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

for ph, fn in [("__DATA__", "aggregate.json"), ("__MATCH__", "matchups.json"), ("__PATTERN__", "patterns.json"), ("__MONTHLY__", "monthly.json")]:
    data = (A / fn).read_text(encoding="utf-8")
    assert ph in app, f"플레이스홀더 {ph} 없음"
    assert "</script" not in data.lower(), f"{fn}에 위험 문자열 포함"
    app = app.replace(ph, data)

# --- 구단 로고 임베드: site/logos/<팀이름>.(png|jpg|jpeg|webp|gif) → data URI ---
# 파일명은 리포트의 팀 표기(KIA, 두산, LG, 삼성, SSG, 롯데, NC, KT, 키움, 한화)
# 또는 아래 별칭을 사용. 파일이 없는 팀은 브랜드 컬러 모노그램 배지로 표시됩니다.
ALIAS = {"엘지":"LG","기아":"KIA","엔씨":"NC","케이티":"KT","에스에스지":"SSG",
         "트윈스":"LG","베어스":"두산","라이온즈":"삼성","자이언츠":"롯데","다이노스":"NC",
         "위즈":"KT","이글스":"한화","타이거즈":"KIA","랜더스":"SSG","히어로즈":"키움"}
import base64, io, json as _json, unicodedata
TEAMS_EN = {"KIA", "LG", "KT", "NC", "SSG"}
logos = {}
LOGO_DIR = BASE / "logos"
if LOGO_DIR.is_dir():
    try:
        from PIL import Image
    except ImportError:
        Image = None
    for f in sorted(LOGO_DIR.iterdir()):
        if f.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"):
            continue
        stem = unicodedata.normalize("NFC", f.stem)  # macOS 한글 파일명(NFD) 정규화
        team = ALIAS.get(stem) or (stem.upper() if stem.upper() in TEAMS_EN else stem)
        raw = f.read_bytes()
        if raw.lstrip()[:4] == b"<svg" or f.suffix.lower() == ".svg":  # 확장자와 무관하게 SVG 감지
            logos[team] = "data:image/svg+xml;base64," + base64.b64encode(raw).decode()
            continue
        try:
            if Image is None:
                raise ImportError
            im = Image.open(f)
            im.thumbnail((96, 96))
            buf = io.BytesIO()
            im.convert("RGBA").save(buf, "PNG", optimize=True)
            logos[team] = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        except Exception:  # PIL 없음/디코딩 실패 시 원본 그대로 임베드
            import mimetypes
            mt = mimetypes.guess_type(f.name)[0] or "image/png"
            logos[team] = f"data:{mt};base64," + base64.b64encode(raw).decode()
assert "__LOGOS__" in app
app = app.replace("__LOGOS__", _json.dumps(logos, ensure_ascii=False))
if logos:
    print("embedded logos:", ", ".join(sorted(logos)))

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
