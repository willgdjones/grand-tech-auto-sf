import { flags } from '@gtasf/shared/flags';
import { FUNDING_ROUNDS, formatFunding, fundingCents, fundingDay, normalizeFundingName,
  type FundingAward, type FundingLeaderboard, type FundingProfile } from '@gtasf/shared/funding';
import { isFounderLocked } from '../founder/hudLock';
import { centerSlot } from '../hud/centerSlot';
import './hud.css';

function el<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text='') {
  const element=document.createElement(tag);element.className=className;element.textContent=text;return element;
}
function button(text:string,className=''){const element=el('button',className,text);element.type='button';return element;}
/**
 * Economy v3 runway (gtasf-kax8, PLAN-economy-v3 §4): seconds of runway before the next DOWN ROUND at
 * the current continuous-burn rate — i.e. how long the funding held above this round's threshold lasts.
 * 0 when already at/below the threshold or when there is no burn. Pure (bigint cents) so the countdown
 * maths is unit-tested without the DOM. Server owns the authoritative value; the HUD only extrapolates
 * the live readout between profile updates.
 */
export function runwaySeconds(totalCents:string,roundThresholdCents:string,burnPerSecCents:string):number {
  let total:bigint,floor:bigint,burn:bigint;
  try{total=BigInt(totalCents);floor=BigInt(roundThresholdCents);burn=BigInt(burnPerSecCents);}catch{return 0;}
  if(burn<=0n||total<=floor)return 0;
  return Number((total-floor)/burn);
}
/** Compact "18h 20m" / "6m 05s" / "45s" runway readout from whole seconds. */
export function formatRunway(seconds:number):string {
  const left=Math.max(0,Math.floor(seconds));
  const h=Math.floor(left/3600),m=Math.floor(left%3600/60),s=left%60;
  return h>0?`${h}h ${m}m`:m>0?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`;
}
/**
 * Economy v3 live-ticking drain (gtasf-kax8, PLAN-economy-v3 §4): the funding shown between server
 * updates, extrapolated DOWN from the last server total at the continuous-burn rate (whole-second
 * granularity). Clamped at 0; a no-op without burn. Pure so the extrapolation is unit-tested. The
 * server stays authoritative — each profile update re-bases this.
 */
export function drainStep(baseCents:bigint,burnPerSec:bigint,elapsedMs:number):bigint {
  if(burnPerSec<=0n||elapsedMs<=0)return baseCents;
  const drained=baseCents-burnPerSec*BigInt(Math.floor(elapsedMs/1000));
  return drained>0n?drained:0n;
}
/**
 * Economy v3 leaderboard row amounts (gtasf-kax8, PLAN-economy-v3 §5): the week/live board is
 * lifetime-ranked (worker store.ts), so under v3 — when an entry carries the server lifetimeCents —
 * its headline is the LIFETIME total (amounts stay in rank order) with the live burned "now" figure
 * (totalCents = current) beside it. The today tab shows today's raised; pre-v3 entries (no lifetimeCents)
 * keep the single totalCents figure, so this is inert until flags.economyV3 ships the field. Pure (picks
 * cents strings; formatting stays in the DOM) so the selection is unit-tested.
 */
export function boardRowAmounts(entry:{totalCents:string;todayCents:string;lifetimeCents?:string},tab:'week'|'today'|'live'|'current'):{headlineCents:string;nowCents:string|null}{
  if(tab==='today')return {headlineCents:entry.todayCents,nowCents:null};
  if(tab==='current')return {headlineCents:entry.totalCents,nowCents:null}; // current board: ranked by burned current (gtasf-econv3-current-leaderboard-gu7k)
  if(typeof entry.lifetimeCents==='string')return {headlineCents:entry.lifetimeCents,nowCents:entry.totalCents};
  return {headlineCents:entry.totalCents,nowCents:null};
}
/**
 * The big centred award toast is reserved for stage-up celebrations and the rarer special sources
 * (VC fund drops, celebrity angels, warm intros). A routine event drive-through shows only the small,
 * non-disruptive SA toast stack (gtasf-96rj: "keep driving straight through"), so a drive-through
 * spree never flashes a centred panel on every cheque. [gtasf-funding-double-award-toast]
 */
export function showsBigAwardToast(award:Pick<FundingAward,'previousRound'|'profile'|'source'>):boolean {
  const promoted=award.previousRound.id!==award.profile.round.id;
  return promoted||Boolean(award.source&&award.source!=='event');
}
export interface FundingHudOptions {
  parent?:HTMLElement;
  /** Existing playable HUD; this module adds controls without a second funding counter. */
  statusParent?:HTMLElement;
  onSaveIdentity(startupName:string,nickname:string):Promise<FundingProfile>;
  /** Optional "I already have a startup" entry on the onboarding dialog (account recovery). */
  onRecover?():void;
  onRefreshLeaderboard():Promise<FundingLeaderboard>;
  onModalChange?(open:boolean):void;
  onDisplayChange?(state:{profile:FundingProfile;displayedCents:string}):void;
  /** Economy v3: fired when a profile arrives at a LOWER round than before (continuous-burn down round),
   *  so the host can show the SA "DOWN ROUND — <from> → <to>" toast. Online decreases only (an offline
   *  drop arrives already-lower with no previous to compare; the server can add an explicit signal later). */
  onDownRound?(fromLabel:string,toLabel:string):void;
  enabled?:boolean;
}

/** Server-owned profiles and awards in; cosmetic DOM updates and user intents out. */
export function createFundingHud(options:FundingHudOptions) {
  if(!(options.enabled??flags.fundingLoop))return null;
  const parent=options.parent??document.body;
  const controls=el('div','gt-funding-controls');
  const boardButton=button('Funding board','gt-funding-open'),identityButton=button('Startup','gt-funding-identity');
  boardButton.setAttribute('aria-label','Open earned funding leaderboard');identityButton.setAttribute('aria-label','Edit startup name and nickname');
  controls.append(boardButton,identityButton);(options.statusParent??parent).append(controls);

  const board=el('dialog','gt-funding-dialog');board.setAttribute('aria-labelledby','gt-funding-board-title');
  const boardClose=button('Close ×','gt-funding-close'),boardTitle=el('h2','','Funding board');boardTitle.id='gt-funding-board-title';
  const explanation=el('p','gt-funding-description',flags.driveThroughFunding
    ?'Drive or walk through an event to get funded — each event pays once, ever. Live events pay ×3. Each other founder adds 10%, up to double.'
    :'Spend 20 seconds at an event to close a deal. Live events pay ×3. Each other founder adds 10%, up to double.');
  const tabs=el('div','gt-funding-tabs');tabs.setAttribute('aria-label','Leaderboard period');
  const tabButtons={week:button('This week'),current:button('Funding now'),today:button('Top raisers today'),live:button('Online now')};
  tabButtons.current.hidden=true; // shown once the server sends an economy-v3 current board
  for(const tab of Object.values(tabButtons))tabs.append(tab);
  const you=el('section','gt-funding-you'),startupName=el('strong','gt-funding-your-name','Your startup is loading…');
  const roundLabel=el('span','gt-funding-your-round');
  const totals=el('div','gt-funding-totals'),weekly=el('div',''),daily=el('div','');
  const weeklyAmount=el('strong','','—'),dailyAmount=el('strong','','—');
  const weeklyRank=el('span',''),dailyRank=el('span','');
  weekly.append(el('span','gt-funding-stat-label','This week'),weeklyAmount,weeklyRank);
  daily.append(el('span','gt-funding-stat-label','Today in SF'),dailyAmount,dailyRank);
  // Economy v3 (gtasf-kax8): the player's own lifetime-raised total (before burn) alongside current.
  // Hidden until the server sends it, so it's inert on pre-v3 profiles. The lifetime LEADERBOARD tab is
  // separate and still needs pane 1's server-side ordering; this is the player's own figure only.
  const lifetime=el('div','gt-funding-lifetime');lifetime.hidden=true;const lifetimeAmount=el('strong','','—');
  lifetime.append(el('span','gt-funding-stat-label','Lifetime raised'),lifetimeAmount);
  totals.append(weekly,daily,lifetime);
  const progress=el('progress','gt-funding-progress');progress.max=100;progress.value=0;progress.setAttribute('aria-label','Progress toward your next funding round');
  const nextRound=el('p','gt-funding-next-round'),resetNote=el('p','gt-funding-reset');
  // Economy v3 runway meter + live drain (gtasf-kax8). Hidden until the server sends a burn rate, so
  // it is inert on pre-economy-v3 profiles and lights up the moment pane 1's continuous-burn data lands.
  const runway=el('div','gt-funding-runway');runway.hidden=true;runway.setAttribute('aria-label','Funding runway before a down round');
  const runwayHead=el('div','gt-funding-runway-head');
  const runwayLabel=el('span','gt-funding-runway-label','RUNWAY'),runwayValue=el('strong','gt-funding-runway-value','—');
  runwayHead.append(runwayLabel,runwayValue);
  const runwayMeter=el('div','gt-funding-runway-meter'),runwayFill=el('div','gt-funding-runway-fill');runwayMeter.append(runwayFill);
  const runwayBurn=el('p','gt-funding-runway-burn');
  runway.append(runwayHead,runwayMeter,runwayBurn);
  you.append(startupName,roundLabel,totals,progress,nextRound,runway);
  const table=el('table','gt-funding-table'),head=el('thead',''),headRow=el('tr',''),rows=el('tbody','');
  for(const label of ['Rank','Startup','Funding']){const cell=el('th','',label);cell.scope='col';headRow.append(cell);}
  head.append(headRow);table.append(head,rows);
  const empty=el('p','gt-funding-empty','Loading the city leaderboard…');
  const boardStatus=el('p','gt-funding-status');boardStatus.setAttribute('role','status');
  const refreshButton=button('Refresh','gt-funding-refresh');
  board.append(boardClose,el('div','gt-funding-kicker','SF TECH WEEK · OCT 5–11'),boardTitle,explanation,you,tabs,resetNote,table,empty,boardStatus,refreshButton);

  const identity=el('dialog','gt-funding-dialog gt-funding-onboarding');identity.setAttribute('aria-labelledby','gt-funding-identity-title');
  const identityClose=button('Close ×','gt-funding-close'),identityTitle=el('h2','','Name your startup');identityTitle.id='gt-funding-identity-title';
  const form=el('form','gt-funding-form');
  const startupLabel=el('label','','Startup name'),startup=el('input','');startup.required=true;startup.maxLength=96;startup.autocomplete='organization';startup.placeholder='Your next big idea';
  const nicknameLabel=el('label','','Your nickname'),nickname=el('input','');nickname.required=true;nickname.maxLength=48;nickname.setAttribute('autocomplete','nickname');nickname.placeholder='What should people call you?';
  startupLabel.append(startup);nicknameLabel.append(nickname);
  const identityStatus=el('p','gt-funding-status');identityStatus.setAttribute('role','status');
  const save=el('button','gt-funding-save','Save startup');save.type='submit';
  form.append(startupLabel,nicknameLabel,identityStatus,save);
  identity.append(identityClose,el('div','gt-funding-kicker','YOUR SAN FRANCISCO STARTUP'),identityTitle,
    el('p','gt-funding-description','Pick a startup name and nickname. They appear on the city leaderboard.'),form);
  if(options.onRecover){
    const recover=button('I already have a startup →','gt-funding-recover');
    recover.addEventListener('click',()=>options.onRecover!());
    identity.append(recover);
  }

  const toast=el('section','gt-funding-toast');toast.hidden=true;toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');
  const toastTitle=el('div','gt-funding-toast-title','TERM SHEET SIGNED'),toastAmount=el('div','gt-funding-toast-amount');
  const toastSource=el('div','gt-funding-toast-source'),toastBonus=el('div','gt-funding-toast-bonus'),headline=el('p','gt-funding-headline');
  toast.append(toastTitle,toastAmount,toastSource,toastBonus,headline);parent.append(board,identity,toast);
  let disposed=false,profile:FundingProfile|undefined,leaderboard:FundingLeaderboard|undefined;
  let displayed=0n,animation=0,toastTimer=0,tab:keyof typeof tabButtons='week';
  let saving=false,refreshing:Promise<void>|undefined,modalOpen=false,returnFocus:HTMLElement|null=null;
  let identityView=0;
  let boardReceivedAt=0,resetAt=0,dayTimer=0,boardDay='';
  const shownAwards=new Set<string>();
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let runwayBaseSec=0,runwayAt=0,runwayTimer=0;
  let drainBase=0n,drainAt=0,drainTimer=0;const DRAIN_MS=500;
  /** The server's continuous-burn rate (cents/sec) off the profile's optional economy-v3 field, or
   *  null when absent/invalid — the whole burn HUD stays inert on pre-economy-v3 profiles. */
  /** The player's own optional economy-v3 lifetime-raised cents (validated), or null when absent/invalid
   *  or while economy v3 is off. Gated on flags.economyV3 (the canonical switch, OFF until the founder
   *  approves the rescale) so the figure can't surface if a migration sets lifetimeCents before the flip. */
  function playerLifetime():string|null{
    if(!flags.economyV3)return null;
    const raw=profile?(profile as {lifetimeCents?:string}).lifetimeCents:undefined;
    if(raw==null)return null;
    try{fundingCents(raw);return raw;}catch{return null;}
  }
  function currentBurn():bigint|null{
    if(!flags.economyV3)return null; // canonical econ-v3 switch (OFF until founder approval) gates the whole burn HUD
    const raw=profile?(profile as {burnPerSecCents?:string}).burnPerSecCents:undefined;
    if(raw==null)return null;
    try{const v=BigInt(raw);return v>0n?v:null;}catch{return null;}
  }

  function publishDisplay(){if(profile&&!disposed)options.onDisplayChange?.({profile,displayedCents:displayed.toString()});}
  function setProfile(next:FundingProfile):boolean {
    if(disposed)return false;
    let total:bigint;
    try{total=fundingCents(next.totalCents);fundingCents(next.todayCents);}catch{return false;}
    if(profile?.lastAwardAt!=null&&next.lastAwardAt!=null&&next.lastAwardAt<profile.lastAwardAt)return false;
    const previous=profile,unchanged=previous?.totalCents===next.totalCents;profile=next;
    // Economy v3 down round: burn pushed funding below a round's threshold (new round is lower-valued).
    if(previous&&BigInt(next.round.thresholdCents)<BigInt(previous.round.thresholdCents))options.onDownRound?.(previous.round.label,next.round.label);
    identityButton.title=next.startupName&&next.nickname?`${next.startupName} · ${next.nickname}`:"Name your startup"; // unnamed players earn too (gtasf-ighk)
    renderProfile();renderRunway();maybeDrain();
    if(unchanged&&animation){publishDisplay();return true;}
    cancelAnimationFrame(animation);animation=0;
    if(!previous||total<=displayed||reducedMotion.matches){displayed=total;publishDisplay();return true;}
    const from=displayed,start=performance.now();
    function tick(now:number){
      if(disposed)return;
      // A frame's timestamp can precede the callback that started this animation.
      const progress=Math.max(0,Math.min(1,(now-start)/850)),eased=1-(1-progress)**3;
      displayed=from+(total-from)*BigInt(Math.round(eased*1000))/1000n;
      publishDisplay();animation=progress<1?requestAnimationFrame(tick):0;
    }
    animation=requestAnimationFrame(tick);return true;
  }
  function serverNow(){return leaderboard?leaderboard.serverNow+performance.now()-boardReceivedAt:Date.now();}
  function todayIsFresh(){return !leaderboard||fundingDay(serverNow())===boardDay;}
  function renderProfile(){
    if(!profile)return;
    startupName.textContent=profile.startupName||'Name your startup';
    // Clamp to 0..5 so the ★/☆ render can't throw a RangeError if the economy-v3 rescale ever yields
    // a stars value outside the 5-rung ladder (repeat() throws on a negative count). [gtasf-kax8]
    const stars=Math.max(0,Math.min(5,profile.round.stars));
    roundLabel.textContent=`${'★'.repeat(stars)}${'☆'.repeat(5-stars)} · ${profile.round.label}`;
    weeklyAmount.textContent=formatFunding(profile.totalCents);weeklyRank.textContent=profile.rank===null?'Unranked':`#${profile.rank} this week`;
    dailyAmount.textContent=todayIsFresh()?formatFunding(profile.todayCents):'—';
    const lt=playerLifetime();if(lt!==null){lifetimeAmount.textContent=formatFunding(lt);lifetime.hidden=false;}else lifetime.hidden=true;
    dailyRank.textContent=!todayIsFresh()?'Updating new day…':profile.todayRank===null?'Your next deal starts today':`#${profile.todayRank} today`;
    const next=FUNDING_ROUNDS.find(round=>BigInt(round.thresholdCents)>fundingCents(profile!.totalCents));
    const total=fundingCents(profile.totalCents),base=BigInt(profile.round.thresholdCents);
    progress.value=next?Number((total-base)*10000n/(BigInt(next.thresholdCents)-base))/100:100;
    nextRound.textContent=next?`${formatFunding((BigInt(next.thresholdCents)-total).toString())} to ${next.label} · ${formatFunding(next.thresholdCents)} target`:`${profile.round.label}. The cap table is now a modern art piece.`;
  }
  function tickRunway(){
    const left=Math.max(0,runwayBaseSec-(performance.now()-runwayAt)/1000);
    runwayValue.textContent=left>0?formatRunway(left):'DOWN ROUND IMMINENT';
    // Cosmetic fill: fraction of a 24h reference remaining (one idle round ≈ 24h per PLAN-economy-v3 §4).
    runwayFill.style.width=`${Math.max(0,Math.min(100,left/864))}%`;
    runway.classList.toggle('gt-funding-runway-low',left>0&&left<3600);
    if(left<=0){clearInterval(runwayTimer);runwayTimer=0;}
  }
  function renderRunway(){
    // Economy v3 (gtasf-kax8): inert + hidden on profiles without the server burn field, so this
    // never changes the pre-v3 funding HUD; lights up the moment pane 1's continuous-burn data lands.
    const burn=currentBurn();
    if(!profile||burn===null){runway.hidden=true;clearInterval(runwayTimer);runwayTimer=0;return;}
    runway.hidden=false;
    runwayBaseSec=runwaySeconds(profile.totalCents,profile.round.thresholdCents,burn.toString());
    runwayAt=performance.now();
    // Founder 2026-10-04: burn is a flat per-stage $/min (less onerous — calibrated to ~10% of an active
    // player's earning rate at that stage), shown as "−$X/min" next to the runway meter. burnPerSecCents is
    // the server's per-second rate, so ×60 = the per-minute figure the founder asked for. [gtasf-kax8]
    runwayBurn.textContent=`−${formatFunding((burn*60n).toString())}/min · a down round drops you from ${profile.round.label}`;
    tickRunway();
    if(!runwayTimer)runwayTimer=window.setInterval(tickRunway,1000);
  }
  /** Re-base and (re)start the always-visible live-ticking drain of the money counter, driving the
   *  existing displayed-cents + onDisplayChange path so the top-right HUD $ visibly burns down. */
  function maybeDrain(){
    const burn=currentBurn();
    if(burn===null||!profile){if(drainTimer){clearInterval(drainTimer);drainTimer=0;}return;}
    try{drainBase=fundingCents(profile.totalCents);}catch{return;}
    drainAt=performance.now();
    if(!drainTimer)drainTimer=window.setInterval(drainTick,DRAIN_MS);
  }
  function drainTick(){
    if(disposed||animation)return; // never fight the award count-up animation
    const burn=currentBurn();
    if(burn===null){clearInterval(drainTimer);drainTimer=0;return;}
    const next=drainStep(drainBase,burn,performance.now()-drainAt);
    if(next!==displayed){displayed=next;publishDisplay();}
  }
  function renderReset(){
    if(!leaderboard){resetNote.textContent='Today’s race resets at midnight in San Francisco.';return;}
    const fresh=todayIsFresh(),minutes=Math.max(1,Math.ceil((resetAt-serverNow())/60_000));
    resetNote.textContent=fresh?`${boardDay} · Daily race resets in ${Math.floor(minutes/60)}h ${minutes%60}m at midnight SF. Weekly funding stays yours.`:'A new day in San Francisco. Updating today’s race…';
  }
  function watchDay(){
    clearTimeout(dayTimer);if(disposed||!leaderboard)return;
    renderReset();
    if(!todayIsFresh()){renderBoard();void refresh();}
    dayTimer=window.setTimeout(watchDay,todayIsFresh()?Math.min(60_000,Math.max(1000,resetAt-serverNow()+20)):60_000);
  }
  function renderBoard(){
    for(const [name,element] of Object.entries(tabButtons))element.setAttribute('aria-pressed',String(name===tab));
    renderProfile();renderReset();
    rows.replaceChildren();
    tabButtons.current.hidden=!leaderboard?.current;
    if(tab==='current'&&!leaderboard?.current)tab='week';
    const entries=leaderboard?(tab==='today'?(todayIsFresh()?leaderboard.today:[]):tab==='live'?leaderboard.week.filter(entry=>entry.live):tab==='current'?leaderboard.current??[]:leaderboard.week):[];
    empty.hidden=entries.length>0;table.hidden=!entries.length;
    empty.textContent=!leaderboard?'Loading the city leaderboard…':tab==='today'&&!todayIsFresh()?'Fetching the new daily standings…':tab==='live'?'No players from the weekly board are online right now.':'No funding raised yet. Visit an event to get started.';
    for(const entry of entries.slice(0,100)){
      const row=el('tr',entry.deviceId===profile?.deviceId?'gt-funding-mine':'');
      const place=tab==='today'?entry.todayRank:entry.rank;
      if(place!==null&&place<=3)row.classList.add('gt-funding-podium');
      const rank=el('td','gt-funding-place',place===null?'—':`#${place}`),name=el('td','gt-funding-startup');
      name.append(el('strong','',entry.startupName||'Stealth startup'),el('span','gt-funding-nickname',`${entry.nickname||'Unnamed founder'} · ${entry.round.label}`)); // unnamed players earn too (gtasf-ighk)
      if(entry.live)name.append(el('span','gt-funding-live','LIVE'));
      const {headlineCents,nowCents}=boardRowAmounts(entry,tab);
      let amount='—';try{amount=formatFunding(headlineCents);}catch{/* Invalid totals are never invented. */}
      const raised=el('td','gt-funding-raised',amount);
      if(nowCents!==null){try{raised.append(el('span','gt-funding-raised-now',`now ${formatFunding(nowCents)}`));}catch{/* current is optional, never invented */}}
      row.append(rank,name,raised);rows.append(row);
    }
  }
  function setLeaderboard(next:FundingLeaderboard):boolean {
    if(disposed||!Number.isFinite(next.serverNow)||(leaderboard&&next.serverNow<leaderboard.serverNow)
      ||!Array.isArray(next.week)||!Array.isArray(next.today))return false;
    if(!setProfile(next.you))return false;
    leaderboard=next;boardReceivedAt=performance.now();
    const nextDay=fundingDay(next.serverNow);
    if(nextDay!==boardDay){
      boardDay=nextDay;
      // Find the next SF midnight even on 23/25-hour DST days, without guessing a UTC offset.
      let low=Math.floor(next.serverNow),high=low+27*60*60_000;
      while(high-low>1){const mid=Math.floor((low+high)/2);if(fundingDay(mid)===boardDay)low=mid;else high=mid;}
      resetAt=high;
    }
    renderBoard();watchDay();return true;
  }
  function publishModal(){
    const open=board.open||identity.open;
    if(open!==modalOpen){modalOpen=open;options.onModalChange?.(open);}
    if(!open&&returnFocus){if(returnFocus.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;}
  }
  function openDialog(dialog:HTMLDialogElement){
    if(disposed)return;
    // While the founder ladder owns the HUD, its found card owns naming: the identity dialog must never
    // become a modal here. showModal() inerts the whole page (even a display:none modal stays inert), so
    // it would swallow the quest-card taps. Guards the showModal() site itself, past the openIdentity() gate.
    if(dialog===identity&&isFounderLocked())return;
    if(!modalOpen)returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const other=dialog===board?identity:board;if(other.open)other.close();
    if(!dialog.open)dialog.showModal();publishModal();
  }
  function hide(){if(board.open)board.close();if(identity.open)identity.close();publishModal();}
  async function refresh(){
    if(disposed)return;if(refreshing)return refreshing;
    boardStatus.textContent='Updating the leaderboard…';refreshButton.disabled=true;
    refreshing=(async()=>{
      try{const next=await options.onRefreshLeaderboard();if(!disposed){if(!setLeaderboard(next))throw new Error('Leaderboard response is unavailable.');boardStatus.textContent='';}}
      catch(error){if(!disposed)boardStatus.textContent=error instanceof Error?error.message:'The leaderboard is unavailable. Try again shortly.';}
      finally{refreshing=undefined;if(!disposed)refreshButton.disabled=false;}
    })();return refreshing;
  }
  function openLeaderboard(){openDialog(board);boardClose.focus({preventScroll:true});void refresh();}
  function openIdentity(message=''){
    // The founder-ladder spine owns naming via its own found card while the HUD is locked; the old
    // up-front "Name your startup" dialog must never open over it (it would intercept the Found-it tap).
    if(disposed||isFounderLocked())return;identityView++;startup.value=profile?.startupName??'';nickname.value=profile?.nickname??'';identityStatus.textContent=message;
    openDialog(identity);startup.focus({preventScroll:true});
  }
  boardButton.addEventListener('click',openLeaderboard);identityButton.addEventListener('click',()=>openIdentity());
  boardClose.addEventListener('click',hide);identityClose.addEventListener('click',hide);refreshButton.addEventListener('click',()=>void refresh());
  for(const dialog of [board,identity]){dialog.addEventListener('close',publishModal);dialog.addEventListener('cancel',event=>{event.preventDefault();hide();});}
  for(const [name,element] of Object.entries(tabButtons))element.addEventListener('click',()=>{tab=name as typeof tab;renderBoard();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(disposed||saving||!form.reportValidity())return;
    let startupName:string,nicknameValue:string;
    try{startupName=normalizeFundingName(startup.value,'startup');nicknameValue=normalizeFundingName(nickname.value,'nickname');}
    catch(error){identityStatus.textContent=error instanceof Error?error.message:'Check your names.';return;}
    const savedView=identityView,savedStartup=startup.value,savedNickname=nickname.value;
    const sameView=()=>!disposed&&identity.open&&identityView===savedView;
    saving=true;save.disabled=true;identityStatus.textContent='Saving your startup…';
    try{
      const canonical=await options.onSaveIdentity(startupName,nicknameValue);
      if(!disposed){
        if(!setProfile(canonical))throw new Error('Your startup could not be updated.');
        // A completed request owns its submitted view, not a newer panel or draft.
        if(sameView()){
          if(startup.value===savedStartup&&nickname.value===savedNickname)hide();
          else identityStatus.textContent='Your earlier names were saved. Save again to keep these changes.';
        }
      }
    }
    catch(error){if(sameView())identityStatus.textContent=error instanceof Error?error.message:'Unable to save. Please try again.';}
    finally{saving=false;if(!disposed)save.disabled=false;}
  });
  renderBoard();
  return {
    element:controls,setProfile,setLeaderboard,openLeaderboard,openIdentity,hide,refresh,
    get isOpen(){return modalOpen;},get animatedCents(){return displayed.toString();},
    showAward(award:FundingAward,suppressBigToast=false){
      if(disposed||shownAwards.has(award.id)||!setProfile(award.profile))return false;
      shownAwards.add(award.id);if(shownAwards.size>256)shownAwards.delete(shownAwards.values().next().value!);
      // The founder-ladder pitch/end cards show the cheque themselves, so its big centred toast would stack
      // BEHIND the card (a phone bug). While a ladder modal is open the host suppresses it (and clears any
      // in-flight toast); the counter + board still updated via setProfile above.
      if(suppressBigToast){clearTimeout(toastTimer);toastTimer=0;toast.hidden=true;return true;}
      // Routine event cheques show only the small SA toast (gtasf-96rj / pj2w); the counter + board
      // already updated via setProfile above, and any in-flight celebration toast finishes its timer.
      if(!showsBigAwardToast(award))return true;
      toastAmount.textContent=`+${formatFunding(award.amountCents)}`;toastSource.textContent=award.eventTitle;
      const promoted=award.previousRound.id!==award.profile.round.id;
      // v2 cap-table cheques (VC drops, celebrity angels, warm intros) read differently from event rooms.
      const source=award.source&&award.source!=='event'?award.source:null;
      const closedTitle=promoted?`${award.profile.round.label.toUpperCase()} CLOSED`:null;
      // A pitch cheque (founder-ladder / VC offices) reuses the 'celebrity' source but is a real VC
      // partner, so it reads "A partner at <firm>", not "Celebrity angel" (eventTitle is "Pitch to <firm>").
      const pitchFirm=source==='celebrity'&&award.eventTitle.startsWith('Pitch to ')?award.eventTitle.slice('Pitch to '.length):'';
      // Store robberies (lane B), missions and the SF pilgrimage (lane C) also pay through the 'celebrity' source;
      // they are not angel cheques, so title them by what the player did (eventTitle is the award label).
      const payout=source==='celebrity'?award.eventTitle.startsWith('Store robbery: ')?{title:'STORE ROBBED',bonus:'Cash grab · the SFPD are on the way'}
        :award.eventTitle.startsWith('Mission: ')?{title:'JOB DONE',bonus:'Mission payout'}
        :award.eventTitle.startsWith('SF pilgrimage: ')?{title:'LANDMARK FOUND',bonus:'SF pilgrimage reward'}:null:null;
      // Keep the cheque's source readable even when it also closes a funding round.
      toastTitle.textContent=source?(source==='vc-drop'?'FUND SECURED':source==='celebrity'?(payout?payout.title:pitchFirm?'CHEQUE SECURED':'ANGEL CHEQUE'):'WARM INTRO'):(closedTitle??'TERM SHEET SIGNED');
      toastBonus.textContent=source?(source==='vc-drop'?'VC fund drop · first through the door':source==='celebrity'?(payout?payout.bonus:pitchFirm?`A partner at ${pitchFirm}`:'Celebrity angel · a hidden backer'):'Warm intro · referral bonus')+(closedTitle?` · ${closedTitle}`:'')
        :[award.timing==='live'?'LIVE ×3':award.timing==='upcoming'?'STARTING SOON ×1.5':'PRE-EVENT / FOLLOW-UP ×0.5',
        ...(award.crowdCount?[`${award.crowdCount} other ${award.crowdCount===1?'founder':'founders'} · +${Math.round((award.crowdMultiplier-1)*100)}% crowd`]:[]),
        ...(award.streakCount>1?[`Deal streak ×${award.streakMultiplier}`]:[])].join(' · ');
      toast.classList.toggle('gt-funding-round-art',promoted&&flags.loadingArt);
      headline.hidden=!promoted;headline.textContent=promoted?award.profile.round.headline:'';
      // critic N34: the payout card takes a turn in the centre slot after MISSION PASSED (and before RANK UP) instead of
      // overprinting both.
      if(flags.centerSlotQueue){clearTimeout(toastTimer);centerSlot.enqueue({naturalMs:6500,show:()=>{toast.hidden=false;},hide:()=>{toast.hidden=true;}});return true;}
      toast.hidden=false;clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>{toast.hidden=true;},6500);return true;
    },
    destroy(){
      if(disposed)return;disposed=true;cancelAnimationFrame(animation);clearTimeout(toastTimer);clearTimeout(dayTimer);clearInterval(runwayTimer);clearInterval(drainTimer);hide();
      board.remove();identity.remove();toast.remove();controls.remove();
    },
  };
}
