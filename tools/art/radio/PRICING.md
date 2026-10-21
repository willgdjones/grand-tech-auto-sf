# Radio generation estimates — checked before generation, 2026-10-04

Task gtasf-jwxu. Founder authorizes at most $15 for this task, within the shared
$30 fal ceiling. Shared ledger before this task: $2.85 reserved. All calls use
`tools/art/fal.mjs`; its ledger reservations include failed/ambiguous submissions.
These are conservative estimates, not invoices. Never automatically resubmit
an unresolved request.

- ACE-Step `fal-ai/ace-step`: $0.0002 / generated second; 20 × 120 s = $0.48.
  Reserve $0.03 per track ($0.60 total) for headroom.
  https://fal.ai/models/fal-ai/ace-step
  https://fal.ai/models/fal-ai/ace-step/api
- Kokoro `fal-ai/kokoro/american-english`: $0.02 / 1,000 characters.
  Each original script is under 1,000 characters; conservatively reserve a whole
  billing unit plus headroom, $0.025 per call. 24 DJ + 6 ad + 4 talk = $0.85.
  https://fal.ai/models/fal-ai/kokoro/american-english
  https://fal.ai/models/fal-ai/kokoro/american-english/api
- Total initial reservation: $1.45. Regeneration requires rechecking remaining
  task and shared reservations; the $15 task limit is not a target to spend.

Both fal model pages explicitly mark commercial use. ACE-Step code/model uses
Apache-2.0 (https://github.com/ace-step/ACE-Step/blob/main/LICENSE); Kokoro's model
card lists Apache-2.0 (https://huggingface.co/hexgrad/Kokoro-82M). Model licensing
does not automatically assign a licence to generated outputs. The release
LICENSE.txt records the generated assets separately from the old CC0 loops.
Only stock synthetic voices are used; no reference voice or artist prompt.

Music output target: MP3 64 kbps stereo, 120 s (~960 kB each); speech MP3 64 kbps
mono. Music + spoken content + old fallback loops must total <25,000,000 bytes.
Sources/recipes are retained; raw WAV files remain in the ignored asset cache.
