#!/usr/bin/env bash
# LANE E: one line naming the Cloudflare incidents that touch us (Workers / Durable Objects / D1 / Pages / CDN 5xx /
# WebSockets), so a QA failure can be tagged "during incident" or not. Lists unresolved ones AND any resolved in the
# last 12 h with their resolved_at: the status page can keep an incident 'identified' for hours after it actually
# ended (2026-10-15: DO incident resolved_at 11:00 PT, still listed until ~14:31), so tag by resolved_at.
curl -s --max-time 10 https://www.cloudflarestatus.com/api/v2/incidents.json | python3 -c '
import json, sys, datetime
try: incidents = json.load(sys.stdin)["incidents"]
except Exception: print("CF: status page unreachable"); sys.exit(0)
now = datetime.datetime.now(datetime.timezone.utc)
def ours(i):
    text = (i["name"] + " " + " ".join(c["name"] for c in i.get("components", []))).lower()
    return any(k in text for k in ("worker", "durable", "d1", "pages", "502", "5xx", "websocket", "cdn"))
def ts(s): return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
live, recent = [], []
for i in incidents:
    if not ours(i): continue
    if not i.get("resolved_at"): live.append("%s (%s, since %sZ)" % (i["name"], i["status"], i["created_at"][11:16]))
    elif now - ts(i["resolved_at"]) < datetime.timedelta(hours=12):
        recent.append("%s (%sZ-%sZ)" % (i["name"], i["created_at"][11:16], i["resolved_at"][11:16]))
print("CF: " + ("; ".join(live) if live else "none live") + (" | resolved <12h: " + "; ".join(recent) if recent else ""))'
