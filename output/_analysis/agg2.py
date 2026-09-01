# -*- coding: utf-8 -*-
import pandas as pd, numpy as np, json, os
OUT = os.path.dirname(os.path.abspath(__file__))
df = pd.read_pickle(os.path.join(OUT, "df_cache.pkl"))

def r(x,n=3):
    try:
        if x is None or (isinstance(x,float) and (np.isnan(x) or np.isinf(x))): return None
        return round(float(x),n)
    except: return None

def rate(a,b): return r(a/b,3) if b and b>0 else None

def zone_arrays(g):
    """returns dict of 10-length arrays (zones 0-8 + out=9) computed on tracked pitches"""
    gt = g[g["zone"]>=0]
    out={}
    for name in ["n","sw","wf","cs","wn","wd"]:
        out[name]=[0]*10
    for z, gg in gt.groupby("zone"):
        z=int(z)
        out["n"][z]=int(len(gg))
        out["sw"][z]=int(gg["swing"].sum())
        out["wf"][z]=int(gg["whiff"].sum())
        out["cs"][z]=int((gg["pitchResult"]=="T").sum())
        out["wn"][z]=r(gg["woba_n"].sum(),2)
        out["wd"][z]=int(gg["woba_d"].sum())
    return out

def pitch_type_stats(g, total_n, side):
    """per pitch-type stats for one player. side='P' or 'B'"""
    res={}
    for st, gg in g.groupby("stuff"):
        n=len(gg)
        if n < 20: continue
        gt = gg[gg["zone"]>=0]
        nz = len(gt); inz = int((gt["zone"]<=8).sum()); oz = nz-inz
        sw=int(gg["swing"].sum()); wf=int(gg["whiff"].sum())
        oz_sw = int(gt[(gt["zone"]==9)]["swing"].sum())
        ts = gg[gg["two_strike"]]
        d={"n":n,"usage":rate(n,total_n),"velo":r(gg["speed"].mean(),1),
           "whiff":rate(wf,sw),"csw":rate(int(gg["csw"].sum()),n),
           "zone":rate(inz,nz),"chase":rate(oz_sw,oz),
           "woba":rate(gg["woba_n"].sum(), gg["woba_d"].sum()),
           "wd":int(gg["woba_d"].sum()),
           "rv100":r(100*gg["rv"].sum()/n,2),
           "putaway":rate(int(ts["k_end"].sum()), len(ts)) if len(ts)>=10 else None,
           "zfreq":[0]*10}
        gz = gt.groupby("zone").size()
        for z,c in gz.items(): d["zfreq"][int(z)]=int(c)
        res[st]=d
    return res

def stance_split(g, col):
    out={}
    for s,gg in g.groupby(col):
        if s not in ("L","R"): continue
        out[s]={"n":len(gg),"woba":rate(gg["woba_n"].sum(),gg["woba_d"].sum()),
                "wd":int(gg["woba_d"].sum()),
                "whiff":rate(int(gg["whiff"].sum()),int(gg["swing"].sum()))}
    return out

def common_stats(g):
    n=len(g)
    pa_end = g[g["is_last"] & g["ev"].notna()]
    ev = pa_end["ev"].value_counts().to_dict()
    pa = int(sum(v for k,v in ev.items() if k!="SH"))
    K=ev.get("K",0); BB=ev.get("BB",0)+ev.get("IBB",0); HBP=ev.get("HBP",0)
    H1,H2,H3,HR = ev.get("1B",0),ev.get("2B",0),ev.get("3B",0),ev.get("HR",0)
    hits=H1+H2+H3+HR
    outs_ip = ev.get("OUT",0)+ev.get("ROE",0)+ev.get("FC",0)+ev.get("SF",0)
    bip = hits-HR+outs_ip
    gt=g[g["zone"]>=0]; nz=len(gt); inz=int((gt["zone"]<=8).sum()); ozn=nz-inz
    sw=int(g["swing"].sum()); wf=int(g["whiff"].sum())
    oz = gt[gt["zone"]==9]; iz = gt[gt["zone"]<=8]
    iz_sw=int(iz["swing"].sum())
    return {"pitches":n,"pa":pa,
        "k":rate(K,pa),"bb":rate(BB,pa),
        "woba":rate(g["woba_n"].sum(), g["woba_d"].sum()),
        "avg":rate(hits, pa-BB-HBP-ev.get("SF",0)) if pa else None,
        "babip":rate(hits-HR, bip),
        "hr":int(HR),"h":int(hits),"kn":int(K),"bbn":int(BB),
        "whiff":rate(wf,sw),"swing":rate(sw,n),
        "csw":rate(int(g["csw"].sum()),n),
        "zone":rate(inz,nz),
        "chase":rate(int(oz["swing"].sum()), len(oz)),
        "zcon":rate(iz_sw-int(iz["whiff"].sum()), iz_sw),
        "fstr":None}

# first-pitch strike
def fstrike(g):
    fp = g[(g["pitchNum"]==1)]
    if len(fp)==0: return None
    ok = fp["pitchResult"].isin(["T","S","F","H","W","V"])
    return rate(int(ok.sum()), len(fp))

pitchers=[]
for pid, g in df.groupby("pitcher_id"):
    cs = common_stats(g); cs["fstr"]=fstrike(g)
    teams = g["p_team"].value_counts()
    p={"id":int(pid),"name":g["pitcher_name"].iloc[0],"team":teams.index[0],
       "hand":g["p_hand"].iloc[0],"games":int(g["gameId"].nunique()),"q":1 if len(g)>=200 else 0,
       **cs,
       "vs":stance_split(g,"stance"),
       "byPitch":pitch_type_stats(g,len(g),"P"),
       "zones":zone_arrays(g)}
    pitchers.append(p)

batters=[]
for bid, g in df.groupby("batter_id"):
    cs = common_stats(g)
    teams = g["b_team"].value_counts()
    st = g["stance"].value_counts()
    b={"id":int(bid),"name":g["batter_name"].iloc[0],"team":teams.index[0],
       "stance":("S" if len(st)>1 and st.min()>len(g)*0.1 else st.index[0]),
       "games":int(g["gameId"].nunique()),"q":1 if len(g)>=200 else 0,
       **cs,
       "vs":stance_split(g,"p_hand"),
       "byPitch":pitch_type_stats(g,len(g),"B"),
       "zones":zone_arrays(g)}
    batters.append(b)

# league baselines
lg = common_stats(df); lg["fstr"]=fstrike(df)
lgp = pitch_type_stats(df,len(df),"P")
for st in lgp: lgp[st].pop("zfreq",None); lgp[st].pop("putaway",None)

# percentiles
def add_pct(players, fields, invert_fields):
    for f in fields:
        vals = sorted([p[f] for p in players if p.get(f) is not None and p.get("q")==1])
        if not vals: continue
        for p in players:
            v=p.get(f)
            if v is None: continue
            import bisect
            pct = 100.0*bisect.bisect_left(vals,v)/max(len(vals)-1,1)
            pct = min(pct,100.0)
            if f in invert_fields: pct = 100.0-pct
            p.setdefault("pct",{})[f]=round(pct)
P_FIELDS=["k","bb","woba","whiff","csw","chase","zone","fstr","babip"]
add_pct(pitchers,P_FIELDS, {"bb","woba","babip"})           # pitcher: high k good, low bb/woba good
B_FIELDS=["k","bb","woba","avg","whiff","chase","zcon","babip"]
add_pct(batters,B_FIELDS, {"k","whiff","chase"})            # batter: low k/whiff/chase good

meta={"games":int(df["gameId"].nunique()),"pitches":int(len(df)),
      "dateFrom":str(df["date"].min()),"dateTo":str(df["date"].max()),
      "pitchers":len(pitchers),"batters":len(batters)}
out={"meta":meta,"league":{"overall":lg,"byPitch":lgp},"pitchers":pitchers,"batters":batters}
js=json.dumps(out,ensure_ascii=False,separators=(",",":"))
with open(os.path.join(OUT,"aggregate.json"),"w",encoding="utf-8") as f: f.write(js)
print("meta:",meta)
print("json bytes:",len(js.encode()))
