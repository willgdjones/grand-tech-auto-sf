/**
 * Dev-only look harness for the founder-ladder DOM overlays (NOT a build entry — only vite dev serves
 * founder-preview.html, so this is tree-shaken out of the production bundle). It mounts the REAL
 * card/quest/valuation modules with sample data so tools/founder-ladder-capture.mjs can screenshot
 * each state at desktop + phone sizes for the look gate. Pick a state with ?state=quest|found|billboard|valuation|all.
 */
import '../theme/saTheme.css';
import { paintFounderBillboard } from './billboard';
import { createFoundCard } from './foundCard';
import { createQuestCard } from './questCard';
import { createShareCard } from './shareCard';
import { createPitchCard } from './pitchCard';
import { FOUNDER_PLAZA_VC_NAME } from '@gtasf/shared/founder/pitch';
import { createValuationHud } from './valuationHud';
import './ladder.css';

/** Deterministic rng so a screenshot always rolls the same name ("Quantum Sourdough"). */
function cycleRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

const state = new URL(location.href).searchParams.get('state') ?? 'found';
const body = document.body;
body.setAttribute('data-founder-locked', ''); // show the locked HUD exactly as a new player sees it

if (state === 'quest' || state === 'billboard' || state === 'all') {
  const quest = createQuestCard(body);
  if (state === 'billboard') quest.set({ kicker: 'YOUR STARTUP', title: 'Quantum Sourdough is live on the Embarcadero.', cta: 'Share your billboard' });
  else quest.set({ kicker: 'YOUR STARTUP', title: 'Found your startup →', cta: 'Found it' });
  quest.show();
}

if (state === 'valuation' || state === 'all') {
  const valuation = createValuationHud(body);
  valuation.set('4200000000'); // $42M — a non-zero valuation so the pill reveals (Series A tier)
}

if (state === 'found' || state === 'all') {
  const card = createFoundCard({ parent: body, onFound() {}, rng: cycleRng([0.0, 0.1]) });
  card.show();
}

if (state === 'share') {
  const card = createShareCard({ parent: body, name: 'Quantum Sourdough',
    copyLink: async () => 'https://gtasf.com/?at=37.7952298,-122.3942110,64.3',
    shareUrl: async () => 'https://gtasf.com/?at=37.7952298,-122.3942110,64.3&ref=abc123' });
  card.show();
}

if (state === 'pitch') {
  const card = createPitchCard({ parent: body, vcName: FOUNDER_PLAZA_VC_NAME,
    onPitch: async () => ({ score: 6, verdict: "Love the energy. We'll circle back after our next fund.", amountCents: '195000000', credited: true, judge: 'ai' }) });
  card.show();
}

if (state === 'billboardface') {
  // The exact CanvasTexture the in-world billboard shows, drawn 2:1 on screen to verify legibility.
  const canvas = document.createElement('canvas');
  paintFounderBillboard(canvas, 'Quantum Sourdough');
  canvas.style.cssText = 'position:fixed;inset:0;margin:auto;width:min(92vw,900px);height:auto;box-shadow:0 20px 60px #000a';
  body.append(canvas);
}
