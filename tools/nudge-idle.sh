#!/bin/sh
# Keeps the GTASF Codex swarm moving: Codex stops after each task, so every
# INTERVAL seconds, any agent pane whose screen hasn't changed since the last
# check and is sitting at the Codex prompt gets told to continue.
SESSION=${SESSION:-GTASF}
INTERVAL=${INTERVAL:-240}
STATE=${STATE:-/tmp/gtasf-nudge}
mkdir -p "$STATE"
MSG="Continue autonomously; never idle waiting on the orchestrator, a preview or the founder. Schedule: DAY (09:00-22:00 PT) = short tasks under 2 h; NIGHT (22:00-08:00) = long graphics/perf lanes (see /tmp/gtasf-night-queue.md). Finish and commit your current bead. If you are blocked, write a handoff note and move on. Then take the next ready bead from br ready that fits the time of day: player-visible fixes and small features first. No deploys (the orchestrator deploys with the founder's OK). Follow tools/swarm/briefs/common.md: tsc/vitest directly with nice, unit tests only for money/economy/server logic. Check the tail of /tmp/gtasf-overnight.md for current priorities. Don't stop to ask for confirmation."
while tmux has-session -t "$SESSION" 2>/dev/null; do
  # Window 0 holds the main lanes (pane 0 is the orchestrator shell); extra windows (e.g. districts) are all agents.
  for target in $(tmux list-panes -s -t "$SESSION" -F '#{window_index}.#{pane_index}' | grep -vx '0\.0'); do
    case $target in 0.*) pane=${target#0.} ;; *) pane=$target ;; esac
    grep -qx "$pane" /tmp/gtasf-nudge-skip 2>/dev/null && continue  # panes deliberately idled to shed load
    now=$(tmux capture-pane -pt "$SESSION:$target" | md5)
    prev=$(cat "$STATE/$target" 2>/dev/null)
    echo "$now" > "$STATE/$target"
    # Idle = screen unchanged since last check and no "esc to interrupt" (works for Codex and Claude Code).
    if [ "$now" = "$prev" ] && ! tmux capture-pane -pt "$SESSION:$target" | grep -qE "esc to interrupt|… \\([0-9]"; then
      # Clear stale input first; a long paste can swallow the first Enter in Claude Code, so press it twice (an extra Enter on an empty prompt is harmless).
      tmux send-keys -t "$SESSION:$target" C-u; printf '%s' "$MSG" | tmux load-buffer -b nudge - && tmux paste-buffer -p -b nudge -t "$SESSION:$target" && sleep 1.5 && tmux send-keys -t "$SESSION:$target" Enter && sleep 1.5 && tmux send-keys -t "$SESSION:$target" Enter && echo "$(date '+%H:%M') nudged $target"
    fi
  done
  sleep "$INTERVAL"
done
