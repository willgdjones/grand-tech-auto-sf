#!/bin/bash
# LANE E: post-deploy smoke for the analytics beacons WITHOUT writing prod data. Each POST carries the gtasf_bot=1 cookie,
# so a live endpoint validates the body and then returns 204 before any D1 write (isBotTraffic). Expected:
#   204 = flag on and route works; 404 = flag off (netBeacon) / route missing; 400 = body rejected (contract drift).
#   tools/qa-beacon-smoke.sh [base-url]
BASE=${1:-https://gtasf.com}
post() { curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE$1" -H 'content-type: text/plain' -H "origin: $BASE" -H 'cookie: gtasf_bot=1' --data "$2"; }
lb=$(post /api/loading/beacon '{"kind":"start","stage":"boot","elapsedMs":10,"mobile":true}')
nb=$(post /api/net/beacon '{"kind":"session","ms":10,"mobile":true}')
echo "loading beacon: $lb (204 = ok)"
echo "net beacon:     $nb (204 = netBeacon live, 404 = flag off)"
flags=$(curl -s "$BASE/api/health" | grep -oE '"(loadingBeacon|loadingBeaconClass|netBeacon)":[a-z]+' | tr '\n' ' ')
echo "health flags:   ${flags:-none listed}"
