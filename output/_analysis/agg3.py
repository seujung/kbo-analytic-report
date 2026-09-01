# -*- coding: utf-8 -*-
import pandas as pd, numpy as np, json, os
OUT = os.path.dirname(os.path.abspath(__file__))
df = pd.read_pickle(os.path.join(OUT, "df_cache.pkl"))

agg = json.load(open(os.path.join(OUT,"aggregate.json"),encoding="utf-8"))
pids = {p["id"] for p in agg["pitchers"]}
bids = {b["id"] for b in agg["batters"]}
df = df[df["pitcher_id"].isin(pids) & df["batter_id"].isin(bids)]
print("pitches in scope:", len(df))

pairs={}
for (pid,bid), g in df.groupby(["pitcher_id","batter_id"]):
    ends = g[g["is_last"] & g["ev"].notna()]
    ev = ends["ev"].value_counts().to_dict()
    pa = int(sum(v for k,v in ev.items() if k!="SH"))
    if pa==0: continue
    rec = [int(len(g)), int(g["swing"].sum()), int(g["whiff"].sum()), pa,
           ev.get("K",0), ev.get("BB",0)+ev.get("IBB",0), ev.get("HBP",0),
           ev.get("1B",0), ev.get("2B",0), ev.get("3B",0), ev.get("HR",0),
           round(float(g["woba_n"].sum()),2), int(g["woba_d"].sum())]
    pairs[f"{int(pid)}_{int(bid)}"] = rec
js = json.dumps(pairs, separators=(",",":"))
open(os.path.join(OUT,"matchups.json"),"w").write(js)
print("pairs:", len(pairs), "bytes:", len(js))
