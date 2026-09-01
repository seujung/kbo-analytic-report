# -*- coding: utf-8 -*-
"""월별 집계: 선수별·리그 월별 성적 → monthly.json"""
import pandas as pd, numpy as np, json, os
OUT = os.path.dirname(os.path.abspath(__file__))
df = pd.read_pickle(os.path.join(OUT, "df_cache.pkl"))
agg = json.load(open(os.path.join(OUT,"aggregate.json"),encoding="utf-8"))
pids = {p["id"] for p in agg["pitchers"]}; bids = {b["id"] for b in agg["batters"]}

df["month"] = df["date"].astype(str).str[:7]
MONTHS = sorted(df["month"].unique())
MIDX = {m:i for i,m in enumerate(MONTHS)}

def rec(g):
    ends = g[g["is_last"] & g["ev"].notna()]
    ev = ends["ev"].value_counts().to_dict()
    pa = int(sum(v for k,v in ev.items() if k!="SH"))
    H = ev.get("1B",0)+ev.get("2B",0)+ev.get("3B",0)+ev.get("HR",0)
    v = g["speed"].mean()
    return [int(len(g)), pa, ev.get("K",0), ev.get("BB",0)+ev.get("IBB",0),
            ev.get("HBP",0), ev.get("SF",0), int(H), ev.get("HR",0),
            round(float(g["woba_n"].sum()),2), int(g["woba_d"].sum()),
            int(g["swing"].sum()), int(g["whiff"].sum()),
            round(float(v),1) if pd.notna(v) else None]

def by_month(g):
    arr=[None]*len(MONTHS)
    for m, gm in g.groupby("month"):
        arr[MIDX[m]] = rec(gm)
    return arr

out = {"months": MONTHS,
       "league": [rec(df[df["month"]==m]) for m in MONTHS],
       "pitchers": {str(int(pid)): by_month(g) for pid,g in df[df["pitcher_id"].isin(pids)].groupby("pitcher_id")},
       "batters":  {str(int(bid)): by_month(g) for bid,g in df[df["batter_id"].isin(bids)].groupby("batter_id")}}
js = json.dumps(out, ensure_ascii=False, separators=(",",":"))
open(os.path.join(OUT,"monthly.json"),"w",encoding="utf-8").write(js)
print("months:", MONTHS, "bytes:", len(js.encode()))
