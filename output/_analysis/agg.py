# -*- coding: utf-8 -*-
import pandas as pd, numpy as np, glob, json, math, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # output/
OUT  = os.path.join(ROOT, "_analysis")
os.makedirs(OUT, exist_ok=True)

pfiles = sorted(glob.glob(os.path.join(ROOT, "*", "*_pitches.csv")))
tfiles = sorted(glob.glob(os.path.join(ROOT, "*", "*_text.csv")))
print("pitch files:", len(pfiles), "text files:", len(tfiles))

# ---------- load pitches ----------
usecols = ["gameId","date","away","home","inn","half","atbat_no","pitcher_id","pitcher_name",
           "batter_id","batter_name","pitchNum","stuff","speed","pitchResult","ball","strike",
           "crossPlateX","topSz","bottomSz","x0","y0","vy0","z0","vz0","ay","az","stance"]
dfs=[]
for f in pfiles:
    try:
        d = pd.read_csv(f, encoding="utf-8-sig", usecols=lambda c: c in usecols)
        dfs.append(d)
    except Exception as e:
        print("ERR", f, e)
df = pd.concat(dfs, ignore_index=True)
print("pitches:", len(df))

for c in ["speed","crossPlateX","topSz","bottomSz","x0","y0","vy0","z0","vz0","ay","az","ball","strike"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")

# plate z via kinematics at y = 0.7083 (middle of plate)
yc = 0.7083
disc = df["vy0"]**2 - 2*df["ay"]*(df["y0"]-yc)
t = (-df["vy0"] - np.sqrt(disc.clip(lower=0))) / df["ay"]
df["pz"] = df["z0"] + df["vz0"]*t + 0.5*df["az"]*t*t
df["px"] = df["crossPlateX"]
tracked = df["px"].notna() & df["pz"].notna() & df["topSz"].notna() & df["bottomSz"].notna() & (df["topSz"]>df["bottomSz"])

HALF_W = 0.83
def zone_of(px,pz,top,bot):
    if not (-HALF_W <= px <= HALF_W and bot <= pz <= top): return 9
    col = min(int((px+HALF_W)/(2*HALF_W/3)),2)
    row = min(int((top-pz)/((top-bot)/3)),2)
    return row*3+col
zv = np.full(len(df), -1, dtype=int)
sub = df[tracked]
zv[tracked.values] = [zone_of(a,b,c,d) for a,b,c,d in zip(sub["px"],sub["pz"],sub["topSz"],sub["bottomSz"])]
df["zone"] = zv   # -1 untracked, 0..8 in-zone, 9 out

df["swing"] = df["pitchResult"].isin(["S","F","H","W","V"])
df["whiff"] = df["pitchResult"].isin(["S","V"])
df["csw"]   = df["whiff"] | (df["pitchResult"]=="T")

# pitcher team: 초 = away bats -> pitcher home
df["p_team"] = np.where(df["half"]=="초", df["home"], df["away"])
df["b_team"] = np.where(df["half"]=="초", df["away"], df["home"])

# pitcher hand inferred from release x0 (catcher view: RHP releases x0<0)
hand = df.groupby("pitcher_id")["x0"].median()
p_hand = {pid: ("L" if v>0 else "R") for pid,v in hand.items()}
df["p_hand"] = df["pitcher_id"].map(p_hand)

# ---------- outcomes from text ----------
rows=[]
for f in tfiles:
    try:
        t_ = pd.read_csv(f, encoding="utf-8-sig")
        t_ = t_[t_["type"].isin([13,23])]
        rows.append(t_[["gameId","atbat_no","text"]])
    except Exception as e:
        print("ERR", f, e)
tx = pd.concat(rows, ignore_index=True).drop_duplicates(subset=["gameId","atbat_no"], keep="first")

def classify(s):
    s = str(s)
    if "홈런" in s: return "HR"
    if "3루타" in s: return "3B"
    if "2루타" in s: return "2B"
    if "1루타" in s or "안타" in s: return "1B"
    if "고의4구" in s or "고의 4구" in s: return "IBB"
    if "볼넷" in s: return "BB"
    if "몸에" in s: return "HBP"
    if "삼진" in s or "낫아웃" in s or "낫 아웃" in s: return "K"
    if "희생플라이" in s or "희생 플라이" in s: return "SF"
    if "희생번트" in s or "희생 번트" in s: return "SH"
    if "실책" in s: return "ROE"
    if "야수선택" in s or "땅볼로 출루" in s: return "FC"
    if "아웃" in s or "병살" in s or "삼중살" in s: return "OUT"
    return "OTHER"
tx["ev"] = tx["text"].map(classify)
tx = tx.set_index(["gameId","atbat_no"])["ev"]

# PA-ending pitch = last pitch of each (gameId, atbat_no)
df["_i"] = np.arange(len(df))
last = df.groupby(["gameId","atbat_no"])["_i"].max()
df["is_last"] = False
df.loc[last.values, "is_last"] = True
key = pd.MultiIndex.from_arrays([df["gameId"], df["atbat_no"]])
df["ev"] = np.where(df["is_last"], pd.Series(key.map(tx.get), index=df.index), None)

W = {"BB":0.69,"HBP":0.72,"1B":0.88,"2B":1.25,"3B":1.58,"HR":2.03}
NUM = lambda e: W.get(e,0.0)
def den_ok(e): return e in ("BB","HBP","1B","2B","3B","HR","K","OUT","ROE","FC","SF","OTHER") and e is not None
df["woba_n"] = df["ev"].map(lambda e: NUM(e) if e else 0.0)
df["woba_d"] = df["ev"].map(lambda e: 1 if den_ok(e) else 0)

# run values by count (batter perspective, rel. to 0-0)
CV = {(0,0):0.0,(1,0):0.032,(2,0):0.088,(3,0):0.186,(0,1):-0.043,(0,2):-0.098,
      (1,1):-0.015,(1,2):-0.080,(2,1):0.037,(2,2):-0.055,(3,1):0.142,(3,2):0.052}
EV_RV = {"BB":0.33,"IBB":0.33,"HBP":0.35,"1B":0.45,"2B":0.75,"3B":1.03,"HR":1.40,
         "K":-0.27,"OUT":-0.25,"ROE":-0.25,"FC":-0.25,"SF":-0.25,"SH":-0.10,"OTHER":-0.25}
# count BEFORE pitch: ball/strike columns are AFTER; reconstruct
b_after = df["ball"].fillna(0).astype(int); s_after = df["strike"].fillna(0).astype(int)
res = df["pitchResult"]
b_before = np.where(res=="B", b_after-1, b_after).clip(0,3)
s_pre = np.where(res.isin(["T","S","V"]), s_after-1, s_after)
s_before = np.where(res.isin(["F","W"]), np.minimum(s_after,2), s_pre)
s_before = np.clip(s_before,0,2)
cv_before = np.array([CV.get((b,s),0.0) for b,s in zip(b_before,s_before)])
cv_after  = np.array([CV.get((min(b,3),min(s,2)),0.0) for b,s in zip(b_after,s_after)])
rv = np.where(df["is_last"] & df["ev"].notna(),
              df["ev"].map(lambda e: EV_RV.get(e,-0.25) if e else 0.0).astype(float) - cv_before,
              cv_after - cv_before)
df["rv"] = rv
df["two_strike"] = (s_before==2)
df["k_end"] = df["is_last"] & (df["ev"]=="K")

df.to_pickle(os.path.join(OUT, "df_cache.pkl"))
print("saved pickle. events:", tx.value_counts().to_dict())
