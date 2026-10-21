#!/bin/zsh
# Critic (pane 1.3) post-deploy replay: play the first 5 minutes on prod headlessly, both profiles, one session each,
# and drop the frames + result.json under docs/critique/replays/<label>/ for the re-ranked "still feels cheap" pass.
# Usage: tools/heavy.sh tools/critique-replay.sh <label e.g. 6.19>
# Steps = the new-player path only (load → found → pitch → seed → job → reload → weapon → crime → escape); no gun shop,
# time trial or standoff (those are lane E's hourly run). Bot device (?bot=1), nothing lands in real funnels.
set -u
label=${1:?deploy label, e.g. 6.19}
out=docs/critique/replays/$label
mkdir -p "$out"
GTASF_QA_URL=${GTASF_QA_URL:-https://gtasf.com} PROFILES=desktop,phone \
  STEPS=load,found,pitch,seed,job,reload,weapon,crime,escape OUT="$out" \
  node tools/qa-prod-playtest.mjs 2>&1 | tee "$out/run.log" | grep -E "PASS|FAIL|ALL PASS|FAILED|console errors|socket"
echo "frames: $out/{desktop,phone}/*.jpg"
