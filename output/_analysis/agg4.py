# -*- coding: utf-8 -*-
import pandas as pd, numpy as np, json, os
OUT = os.path.dirname(os.path.abspath(__file__))
df = pd.read_pickle(os.path.join(OUT, "df_cache.pkl"))

agg = json.load(open(os.path.join(OUT,"aggregate.json"),encoding="utf-8"))
pids = {p["id"] for p in agg["pitchers"]}
df = df[df["pitcher_id"].isin(pids)].copy()

# count BEFORE pitch (same reconstruction as agg.py)
b_after = df["ball"].fillna(0).astype(int); s_after = df["strike"].fillna(0).astype(int)
res = df["pitchResult"]
b_before = np.where(res=="B", b_after-1, b_after).clip(0,3)
s_pre = np.where(res.isin(["T","S","V"]), s_after-1, s_after)
s_before = np.clip(np.where(res.isin(["F","W"]), np.minimum(s_after,2), s_pre),0,2)
df["cnt"] = [f"{b}-{s}" for b,s in zip(b_before,s_before)]
COUNTS = ["0-0","0-1","0-2","1-0","1-1","1-2","2-0","2-1","2-2","3-0","3-1","3-2"]
CIDX = {c:i for i,c in enumerate(COUNTS)}

# prev pitch type within same at-bat
df = df.sort_values(["gameId","atbat_no","pitchNum"])
g = df.groupby(["gameId","atbat_no"])
df["prev"] = g["stuff"].shift(1)

def pat_for(gg):
    types = [t for t,c in gg["stuff"].value_counts().items() if c>=20]
    cnts={}; seq={}; stance={}
    for t in types:
        gt = gg[gg["stuff"]==t]
        arr=[0]*12
        for c,n in gt["cnt"].value_counts().items():
            if c in CIDX: arr[CIDX[c]]=int(n)
        cnts[t]=arr
        sc = gt["stance"].value_counts()
        stance[t]=[int(sc.get("L",0)),int(sc.get("R",0))]
    gs = gg[gg["prev"].notna() & gg["stuff"].isin(types) & gg["prev"].isin(types)]
    for (a,b0),n in gs.groupby(["prev","stuff"]).size().items():
        seq.setdefault(a,{})[b0]=int(n)
    return {"counts":cnts,"seq":seq,"stance":stance}

out={}
for pid, gg in df.groupby("pitcher_id"):
    out[str(int(pid))] = pat_for(gg)

# league count mix baseline: per count, type share
lg={}
for c, gc in df.groupby("cnt"):
    if c not in CIDX: continue
    tot=len(gc)
    lg[c]={t:round(n/tot,3) for t,n in gc["stuff"].value_counts().items() if n/tot>=0.01}
res_js={"counts_order":COUNTS,"league":lg,"pitchers":out}
js=json.dumps(res_js,ensure_ascii=False,separators=(",",":"))
open(os.path.join(OUT,"patterns.json"),"w",encoding="utf-8").write(js)
print("pitchers:",len(out),"bytes:",len(js.encode()))
