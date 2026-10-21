import './style.css';
import './theme/saTheme.css';
import * as THREE from 'three';
import { flags } from '@gtasf/shared/flags';
import { focusVenues, groupVenues, representativeEvent, WEEK_WINDOW_MS } from './events/venues';
import type { PlayerMode, Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import { normalizeNickname } from '@gtasf/shared/protocol/nickname';
import { sampleCableCar } from '@gtasf/shared/transit/cableCars';
import { formatFunding, fundingCents, fundingDay, FUNDING_ROUNDS, type FundingLeader, type FundingProfile, type FundingRound } from '@gtasf/shared/funding';
import { billboardRankForRound, seriesAQuestReady } from '@gtasf/shared/founder/ladder';
import { decodeAppearance, defaultAppearance, encodeAppearance, resolveLook, LOOK_TIERS, tierForRound, type Appearance } from '@gtasf/shared/content/cosmetics';
import { setupOnboarding } from './onboarding/integrate';
import { mountFounderLadder, loadFounderSession } from './founder/controller';
import { createFounderBillboard, type FounderBillboard } from './founder/billboard';
import { createFounderCityBillboards } from './founder/cityBillboards';
import { createFounderPlazaInvestor } from './founder/plazaInvestor';
import { createGuidedOpener, openerPending, type GuidedOpener } from './founder/guidedOpener';
import { createControlsPanel } from './hud/controlsPanel';
import { createFounderMemeNpcs } from './founder/memeNpcs';
import { createFounderDriveQuest } from './founder/driveQuest';
import { createFounderDemoDay } from './founder/demoDay';
import { createFounderMissionRunner } from './founder/missionRunner';
import { createTaxiFarePassenger, type TaxiFarePassenger } from './founder/taxiFarePassenger';
import { centerSlot } from './hud/centerSlot';
import { createMissionPresentation, type MissionPresentation } from './founder/missionPresentation';
import { createMissionPhone, type MissionPhone } from './founder/missionPhone';
import { createPhoneCall, type PhoneCall } from './founder/phoneCall';
import { createStreetRaceClient, type StreetRaceClient } from './founder/streetRaceClient';
import { createBountyClient, type BountyClient } from './founder/bountyClient';
import { createRankUpSplash, type RankUpSplash } from './founder/rankUp';
import { createCoopHeistClient, type CoopHeistClient } from './founder/coopHeistClient';
import { createPilgrimageTracker, type PilgrimageTracker } from './founder/pilgrimage';
import { pilgrimageSiteById } from '@gtasf/shared/founder/pilgrimage';
import { driveCopyOf } from '@gtasf/shared/founder/memeQuests';
import { createFounderMissionGivers } from './founder/missionGivers';
import { createStuntTracker } from './founder/stuntBonus';
import { saMissionStinger } from './theme/saMission';
import { MISSIONS, MISSION_ARRIVE_RADIUS_M, missionById, missionEnabled, type MissionObjective, type MissionSpec } from '@gtasf/shared/founder/missions';
import { createTimeTrialRunner, type TimeTrialState } from './founder/timeTrialRunner';
import { createTimeTrialHud, type TimeTrialHud } from './founder/timeTrialHud';
import { createTimeTrialLeaderboard, type TimeTrialLeaderboard } from './founder/timeTrialLeaderboard';
import { createGhostRacer, ghostTimeAtPosition, type GhostData } from './founder/timeTrialGhost';
import { TIME_TRIALS, type TimeTrialRecord } from '@gtasf/shared/founder/timeTrials';
import { createFounderFollowers } from './founder/followers';
import { createCofounderRecruits } from './founder/cofounderRecruits';
import { createFounderShareQuest } from './founder/shareQuestClient';
import { createPitchCard, type PitchCard } from './founder/pitchCard';
import { createFounderCrown } from './founder/crown';
import { isMobileDevice, startSessionHeartbeat } from './analytics/heartbeat';
import { createPitchHint } from './pitch/hint';
import { track as trackAnalytics } from './analytics';
import { createLoadingBeacon } from './analytics/loadingBeacon';
import { createSpokenCaptions } from './voice/caption';
import { onboardingStepName } from './analytics/onboarding';
import { createTutorialDriver, tutorialTarget } from './onboarding/tutorialDriver';
import { createTutorialBeacon } from './onboarding/beacon';
import { ThirdPersonCamera } from './camera/thirdPerson';
import { createMapCameraCollision } from './game/cameraCollision';
import { avatarOutfits, DEFAULT_LOOK_OUTFITS, loadAvatarTemplate } from './avatar/riggedAvatar';
import { createHeldWeapon, type HeldWeapon } from './avatar/heldWeapon';
import { setNearDetailWarmer } from './vehicles/models/vehicle';
import { setNearDetailFocus } from './vehicles/models/visibleLod';
import type { AvatarInstance } from './avatar/riggedAvatar';
import { avatarLookChoices } from './avatar/appearance';
import { createAppearanceState } from './avatar/appearanceState';
import { withFounderStatus } from './avatar/founderStatus';
import { createWardrobe } from './avatar/wardrobe';
import { consumesTextKeys, createActions } from './input/actions';
import { Input } from './input/input';
import { bindKeyboard } from './input/keyboard';
import { isInvertLook } from './input/invertLook';
import { bindPointer } from './input/pointer';
import { holdFreeCursor } from './input/cursor';
import { connectWorld } from './net/ws';
import { admissionBlocked, waitForAdmission } from './admission/client';
import { createRemotes } from './net/remotes';
import { createRenderFoundation } from './render/foundation';
import { loadLombardWorld, prefetchMapCore, LOMBARD_DESTINATION, LOMBARD_SPAWN } from './render/chunks/world';
import { loadMapCoastline } from './render/chunks/coastline';
import { createWalkingRouter } from './radar/walking';
import { updateOnFoot } from './movement/onFoot';
import { createRideSystem } from './movement/rideSystem';
import { createMayhemController, type MayhemHit } from './mayhem/mayhemController';
import { MAYHEM_ITEMS, MAYHEM_DEFAULT_COLOUR, mayhemItemIndex } from '@gtasf/shared/content/mayhem';
import { FOUNDER_OPENING_DRIVE_START, founderPlazaAngel, FOUNDER_PLAZA_VC_NAME, FOUNDER_SEED_VC_ID, FOUNDER_SERIES_A_ID, FOUNDER_SERIES_A_NAME, FOUNDER_SERIES_A_PLACE } from '@gtasf/shared/founder/pitch';
import { loadOnboardingState } from './onboarding/api';
import { PITCH_VCS } from '@gtasf/shared/content/pitchVcs';
import { createRemoteRides } from './movement/remoteRides';
import { fastestUnlockedRide, PERSONAL_RIDES, RIDING_POSE_FLAG } from '@gtasf/shared/content/rides';
import type { GroundPose, MovementWorld } from './movement/world';
import { applyCarBumps, createDrivingState, updateDriving } from './vehicles/driving/controller';
import { isOnBuildingRoof } from './vehicles/driving/roofGuard';
import { advanceHangRecovery } from './vehicles/driving/hangRecovery';
import { createQuickRide } from './vehicles/robotaxi/quickRide';
import { createRobotaxiPicker, type TaxiChoice } from './hud/robotaxiPicker';
import { createRobotaxiClient } from './vehicles/robotaxi/client';
import { selectTaxiDestination } from './vehicles/robotaxi/select';
import { resolveRobotaxiDestination } from './vehicles/robotaxi/destination';
import { createTrafficControls } from './vehicles/cruise';
import type { DrivingState } from './vehicles/driving/controller';
import { createFleet } from './game/fleet';
import { createReconnectNotice } from './net/reconnectNotice';
import { createNetBeacon } from './analytics/netBeacon';
import { vehicleEntryMode } from './game/vehicleEntry';
import { createRadar } from './radar/radar';
import type { RadarDestination, RadarEvent, RadarPeer } from './radar/radar';
import { projectLocation } from './radar/projection';
import { createPlayableHud } from './hud/playableHud';
import { createStreetHud } from './hud/streetHud';
import { createGameOptions } from './hud/gameOptions';
import { createCombat } from './combat';
import { createCombatVfx } from './combat/vfx';
import { onPedWasted, reportGunfire, reportPedWasted, reportVehicle, onPedPunch } from './combat/alerts';
import { createPoliceOfficers, type PoliceOfficerEntry } from './combat/policeOfficers';
import { createVehicleFx } from './combat/vehicleFx';
import { createVitalPickups } from './combat/vitalPickups';
import { createShotFeel, type ShotFeel } from './combat/shotFeel';
import { createLoopVoice, engineRate, loopSample, preloadSamples } from './audio/samples';
import { HURT_VOICES, otherHurtGrunt, selfHurtGrunt } from './audio/hurtGrunts';
import { createSkids, type SkidInput } from './vehicles/skids';
import { createPoliceBarks, type PoliceBarks } from './combat/policeBarks';
import { RAM_SHOVE_MPS } from '@gtasf/shared/combat/policeRam';
import { playExplosion } from './audio/explosion';
import type { ShotEvent } from './combat/fire';
import { isAgeAcknowledged, isAgeDeclined, isGoreEnabled } from './combat/ageGate';
import { createPoliceLights } from './combat/policeLights';
import { createSiren } from './combat/siren';
import { createWeaponPickups } from './combat/weaponPickups';
import { createCarjackEffect } from './combat/carjack';
import { createTrafficDrivers } from './combat/trafficDrivers';
import { createStoreRobberies } from './combat/storeRobbery';
import { STORE_ROBBERIES } from '@gtasf/shared/combat/storeRobbery';
import { HELICOPTER_SIGHT_M, POLICE_FLAG, POLICE_ID_BASE, POLICE_SIGHT_M } from '@gtasf/shared/combat/police';
import { playGunshot } from './combat/gunshot';
import { HIDEOUTS, RESPRAY_SHOPS } from '@gtasf/shared/combat/escape';
import { WEAPON_ORDER, WEAPONS, type WeaponId } from '@gtasf/shared/combat/weapons';
import { SF_GENERAL_RESPAWN } from '@gtasf/shared/combat/economy';
import { nearestHospital, RESPAWN_HOSPITALS } from '@gtasf/shared/combat/respawn';
import { openSaveStartup, openRestoreStartup, isRecoveryDialogOpen, onRecoveryDialogChange, closeRecoveryDialogs } from './recovery/panel';
import { createEmailCaptureIntegration } from './email/integrate';
import { isEmailDialogOpen, onEmailDialogChange, closeEmailDialogs, openEmailCapture } from './email/card';
import { createPhoneHud } from './hud/phoneHud';
import { createPauseMenu } from './hud/pauseMenu';
import { createWhatsNew } from './hud/whatsNew';
import { createToasts } from './hud/toast';
import { createProximityVoice } from './voice/client';
import { createVoiceUi } from './voice/ui';
import { createNameplates } from './hud/nameplates';
import { createCapTable } from './hud/capTable';
import { createBecomeAnAngel } from './hud/becomeAnAngel';
import { createAdSlotPage } from './hud/adSlotPage';
import { createAdSlotMarkers } from './hud/adSlotMarkers';
import { createChat } from './chat/client';
import { createFriendsPanel } from './friends/friendsPanel';
import { createFriendsClient, type FriendPresence } from './friends/client';
import { createIdentityScreen } from './hud/identity';
import { createRadio } from './audio/radio';
import { createVehicleAudio } from './audio/vehicles';
import { createProceduralSfx } from './audio/sfx';
import { createCityLife, type CityLifeDestination } from './render/cityLife';
import { createStreetWalkers } from './render/streetWalkers';
import { createFerryPedestrians } from './render/ferryPedestrians';
import { createAngelInvestors } from './render/angelInvestors';
import { createAngelPitch } from './funding/angelPitch';
import { celebLabel } from '@gtasf/shared/content/celebs';
import { createCoffeeQueue } from './render/coffeeQueue';
import { createPeerImpostors } from './render/peerImpostors';
import { playSplat } from './audio/splat';
import { VOICE_GATE_HEADER } from './voice/gate';
import { createDoloresWeekend } from './render/doloresWeekend';
import { createCreatorLinks } from './hud/creator';
import { createEventMarkers } from './events/markers';
import { bindWorldEventLinks } from './events/worldEventLinks';
import { createCollectedEvents } from './events/collected';
import { createUpcomingEvents } from './events/upcoming';
import { createEventFeed } from './events/feed';
import { createEventSubmit } from './hud/eventSubmit';
import { createFeedback, unprojectLocation } from './hud/feedback';
import { createLinkedDestination } from './events/linkedDestination';
import { organiserChannel, organiserTrack, showOrganiserCard } from './gtm/organiserCard';
import { createRouteGuidance } from './navigation/guidance';
import { createOutbidPanel } from './outbid/panel';
import { createOutbidCrown } from './render/landmarks/outbidCrown';
import { createCinematic } from './cinematic/controller';
import { installLoadingArt } from './loading/art';
import { waitForCityConnection } from './loading/connection';
import { initReferrals, referralShareUrl } from './referrals/client';
import { createReferralPanel } from './referrals/panel';
import { createFundingClient, prefetchFundingProfile } from './funding/client';
import { createFundingHud } from './funding/hud';
import { createFundingRoom } from './funding/room';
import { createDropsClient } from './drops/client';
import { createDropBanner } from './drops/banner';
import { createDropCheckpoint } from './drops/checkpoint';
import { dropRadarBlips } from './drops/radarBlip';
import { createFundingPerks } from './funding/perks';
import { createStreetProps } from './render/props/streetProps';
import { kerbCarBlocks, kerbCarBodies, nearestKerbCar, restoreKerbCar, takeKerbCar } from './render/props/kerbCars';
const KERB_STEAL_M = 3; // gtasf-0lnjq: E within this of a kerb-parked car steals it
import { createCarContact, type ContactBody } from './vehicles/driving/contact';
import { playCrunch } from './audio/crunch';
import { createPlazaFurniture } from './render/props/plazaFurniture';
import { createGoogleTiles } from './render/googleTiles';
import { createParkedVehicles } from './render/props/parkedVehicles';
import { createParodyBillboards } from './render/props/billboards';
import { createSkyAds } from './render/sky/skyAds';
import { createRoadDetails } from './render/roads';
import { beginHeavyFrame } from './render/mountScheduler';
import { createLidarRoofs } from './render/lidarRoofs';
import { createGrantAveLanterns } from './render/grantAveLanterns';
import { createLandmarkNightLights } from './render/landmarks/landmarkNight';
import { createPlaceStamps } from './places/stamps';
import { createPlaceSigns } from './places/signs';
import { MARKET_NEON, marketNeonSteps } from './render/landmarks/marketNeon';
import { createPlacedLandmarks, createPlacedLandmarksSliced, DEFERRABLE_LANDMARK_IDS, disposeLandmark, ferrySpawn, LANDMARKS, landmarkPosition, updateLandmarkTerrain, withLandmarkSurfaces } from './render/landmarks/landmarks';
import { copyGameLink, copyLocation, FERRY, headingToYaw, locationLink, PLACES, placePoint, resolveSpawn, snapSpawn } from './spawn/locations';
import type { SpawnRequest } from './spawn/locations';
import { createHarness } from './testing/core';
import { scenarios } from './testing/scenarios';

const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
const population = document.querySelector<HTMLElement>('#population')!;
const loading = document.querySelector<HTMLElement>('#loading')!;
const loadingDetail = document.querySelector<HTMLElement>('#loading-detail')!;
const prompt = document.querySelector<HTMLElement>('#prompt')!;
const statusLine = document.querySelector<HTMLElement>('#trip-status')!;
const harness = flags.testingHarness ? createHarness() : undefined;
const encodePose = (p: GroundPose, poseFlags = 0): Pose => ({
  x: Math.round(p.x * 100), y: Math.round(p.y * 100), z: Math.round(p.z * 100),
  yaw: Math.round(((p.yaw / (Math.PI * 2)) % 1 + 1) % 1 * 256) % 256, flags: poseFlags,
});
const decodePose = (p: Pose): GroundPose => ({ x: p.x / 100, y: p.y / 100, z: p.z / 100, yaw: p.yaw / 256 * Math.PI * 2 });
if (flags.bootstrapScene) void boot().catch(error => {
  loading.hidden = false; loading.classList.add('failed');
  loadingDetail.textContent = error instanceof Error ? error.message : String(error);
  document.querySelector<HTMLElement>('#loading-back')!.hidden = false;
  console.error(error);
});

// Avoid replacing unchanged text nodes or attributes on every animation frame.
function setStatusText(node: HTMLElement, text: string) {
  if (node.textContent !== text) node.textContent = text;
}
function setStatusData(node: HTMLElement, key: string, value: string) {
  if (node.dataset[key] !== value) node.dataset[key] = value;
}

async function boot() {
  const creatorLinks = createCreatorLinks();
  const params = new URLSearchParams(location.search), preset = params.get('preset');
  const cinematicRequested = flags.cinematicCapture && flags.testingHarness && params.has('cinematic');
  performance.mark('gtasf:boot');
  const loadingBeacon = createLoadingBeacon(); // no-PII start / ready / abandon-before-READY counts
  // Start the road graph now, not after admission/referrals [gtasf-ce5s]. A plain URL spawns at the Ferry, so its
  // near-graph part is known before the spawn lookup. [gtasf-0k01]
  const defaultArrival = location.pathname === '/' && !params.has('at');
  prefetchMapCore(undefined, defaultArrival ? FERRY.slug : undefined);
  // The explicit offline director has no World session and must not reserve a player slot.
  // Cold load: admission (its own ticket), referrals (device cookie) and the spawn lookup are independent
  // round trips, so they run together instead of one after another. [gtasf-0k01]
  // openingDrive (critique #13): a brand-new player on the plain URL (no ladder session on this device, onboarding never
  // completed) starts in a car on the Embarcadero, a drive from Pear VC. Unknown onboarding state = the normal Ferry spawn.
  // guidedOpener replaces the in-car spawn: its tutorial starts on foot at the Ferry and walks the player to a car.
  const openingDriveCandidate = flags.openingDrive && !flags.guidedOpener && flags.actionOpening && flags.founderLadder && flags.pitching && flags.driving
    && flags.hud && flags.multiplayer && defaultArrival && !cinematicRequested && !loadFounderSession().founded;
  // slicedLandmarkBuild: the landmark build (~2.5 s of phone CPU) needs neither admission nor the spawn, so start it here and
  // let its slices use the main thread while those round trips are in flight (gtasf-ep30n).
  // deferFarLandmarks (gtasf-g8ty9): on the default Ferry arrival the far street-level set builds after READY (see firstFrame).
  const deferredLandmarkIds = flags.deferFarLandmarks && defaultArrival ? LANDMARKS.map(def => def.id).filter(id => DEFERRABLE_LANDMARK_IDS.includes(id)) : [];
  const landmarkIds = LANDMARKS.map(def => def.id).filter(id => id !== 'lombard-flower-beds' && !deferredLandmarkIds.includes(id));
  // landmarkSliceLong (#6.42 cold-READY hold, 10-19): 12 ms slices spread the build behind world-loaded (+~4 s on a cold
  // 4x phone); before READY only the loading card animates, so ~48 ms slices still let fetches dispatch.
  const earlyLandmarks = flags.slicedLandmarkBuild ? createPlacedLandmarksSliced({ ids: landmarkIds }, flags.landmarkSliceLong ? 48 : 12) : undefined;
  earlyLandmarks?.catch(() => {}); // a boot that fails before awaiting it must not also report an unhandled rejection
  const [, , resolvedSpawn, onboardedBefore] = await Promise.all([
    cinematicRequested ? undefined : waitForAdmission(),
    // Referrals and earned funding share an authenticated device cookie.
    cinematicRequested ? undefined : initReferrals(),
    flags.deepLinkSpawns ? resolveSpawn() : Promise.resolve<SpawnRequest>({ place: FERRY, explicit: false }),
    openingDriveCandidate ? loadOnboardingState().then(state => state?.completed === true, () => true) : Promise.resolve(true),
  ]);
  const openingDrive = openingDriveCandidate && !onboardedBefore && !resolvedSpawn.explicit;
  const request: SpawnRequest = openingDrive
    ? { explicit: false, place: { slug: 'opening-drive', title: 'The Embarcadero', ...FOUNDER_OPENING_DRIVE_START } } : resolvedSpawn;
  let openingCarAsked = !openingDrive; // sent once, on the first WELCOME
  // Device cookie exists now (admission/referrals): start the funding profile read instead of at HUD setup (~1.5 s on 4G).
  if (!cinematicRequested) prefetchFundingProfile();
  const removeLoadingArt = installLoadingArt(loading, request.place.title);
  // Organiser links: count the visit as soon as the /e/ spawn resolves, so visitors who leave during loading
  // are counted too (the card itself only appears once the world is built).
  if (flags.organiserLinks && request.place.organiser && request.place.eventId) organiserTrack(request.place.eventId, organiserChannel(), 'view');
  // Stage progress on the loading card (gtasf-ce5s): a filling bar and a fun line per boot stage.
  const loadStage = (percent: number, text: string) => {
    if (loading.classList.contains('failed')) return;
    performance.mark(`gtasf:stage-${percent}`); // cold-load trace phases
    loadingBeacon?.stage(percent < 50 ? 'download' : percent < 75 ? 'paving' : percent < 90 ? 'parking' : 'joining');
    loading.dataset.stage = String(percent); loading.style.setProperty('--load', `${percent}%`); loadingDetail.textContent = text;
  };
  loadStage(12, `Downloading San Francisco… (${request.place.title})`);
  // earlyWorldSocket (gtasf-ep30n): yield once before the long synchronous renderer/world setup. On a phone that setup is a
  // ~2.7 s task, and the funding-profile prefetch above was not dispatched until it ended (fetch called at 1.85 s, request
  // sent at 4.54 s in lane C's prod trace), putting the profile read on the critical path. The stage line paints too.
  if (flags.earlyWorldSocket) await new Promise(resolve => setTimeout(resolve, 0));
  const tier = preset === 'low' || preset === 'medium' || preset === 'high' ? preset : undefined;
  const foundation = createRenderFoundation({ canvas, tier });
  const { renderer, scene } = foundation;
  // carNearDetail: compile + upload a lazily loaded HD car before it is first drawn up close (no first-approach stall).
  if (flags.carNearDetail) setNearDetailWarmer(async root => {
    const textures = new Set<import('three').Texture>();
    root.traverse(o => { const m = (o as { material?: unknown }).material; for (const mat of Array.isArray(m) ? m : m ? [m] : [])
      for (const v of Object.values(mat as object)) if ((v as { isTexture?: boolean })?.isTexture) textures.add(v as import('three').Texture); });
    // One texture upload per frame (gtasf-qvajw: all of an HD car's textures at once was a ~0.3 s long task on a phone).
    for (const t of textures) { renderer.initTexture(t); await new Promise(resolve => requestAnimationFrame(resolve)); }
    await renderer.compileAsync(root, new THREE.PerspectiveCamera(), scene).catch(() => {}); // any camera compiles the programs
  });
  const initial = placePoint(request.place);
  const worldLoad = Promise.all([
    loadLombardWorld({ mountGeometry: foundation.mountGeometry, mountFar: foundation.mountFar, tier: foundation.tier, position: initial, snapToRoad: request.explicit,
      // Scripted/cinematic runs need the whole city graph before READY (gtasf-0k01 near graph is play-only).
      nearGraph: cinematicRequested || params.has('test') || params.get('capture') === '1' ? false : undefined }),
    loadAvatarTemplate(), createFleet(scene),
  ]);
  // Cold load: build landmark geometry (seconds of phone CPU) while the map and road graph download; they
  // are placed on the real ground below. Lombard flower beds drape over terrain, so they wait. [gtasf-0k01]
  const landmarksBuild = earlyLandmarks ?? Promise.resolve(createPlacedLandmarks({ ids: landmarkIds }));
  const [[world, avatarSource, fleet], landmarks] = await Promise.all([worldLoad, landmarksBuild]);
  const landmarkNight = createLandmarkNightLights(landmarks); // Salesforce crown + Bay Lights at night
  performance.mark('gtasf:world-loaded'); // graph decoded + avatar/fleet ready (cold-load trace)
  if (!world) throw new Error('The local map is disabled. Enable mapStreaming to play.');
  // gtasf-0k01: with flags.nearRoadGraph the world starts on a spawn-area graph; the full city graph is
  // requested only once READY has painted, then swapped in (world.graph/nearestRoad/roadHeightAt are lazy).
  let markGraphReady!: () => void;
  const graphReadySignal = world.graphComplete ? Promise.resolve() : new Promise<void>(resolve => { markGraphReady = resolve; });
  const fullGraph = world.graphComplete ? Promise.resolve() : graphReadySignal
    .then(() => world.upgradeGraph()).then(() => undefined);
  fullGraph.catch(error => console.warn('City road graph could not load; keeping the spawn-area graph.', error));
  // Same placement as createPlacedLandmarks({ heightAt }) would have done at creation.
  for (const landmark of landmarks.children) {
    const definition = landmark.userData.definition as Parameters<typeof landmarkPosition>[0] | undefined;
    if (definition) landmark.position.y = landmarkPosition(definition, world.surfaceHeightAt).y;
  }
  for (const flowerBeds of createPlacedLandmarks({ ids: ['lombard-flower-beds'], heightAt: world.surfaceHeightAt }).children.slice()) landmarks.add(flowerBeds);
  updateLandmarkTerrain(landmarks, world.surfaceHeightAt, (x, z, m) => world.nearestRoad(x, z, m));
  const authoredSurface = withLandmarkSurfaces({ heightAt: () => null }, landmarks);
  // The Pier quay exit needs real base contact; the null-base probe only detects authored height.
  const authoredCollisionSurface = withLandmarkSurfaces({ heightAt: world.heightAt }, landmarks);
  const avatarTemplate = withFounderStatus(avatarSource, {
    scene, heightAt: (x, z, y) => authoredSurface.heightAt(x, z) ?? world.surfaceHeightAt(x, z, y),
    collides: (x, y, z, radius) => Boolean(authoredCollisionSurface.collidesCircle?.(x, z, radius)) || world.collides(x, y, z, radius),
    isLoaded: (x, z) => authoredSurface.heightAt(x, z) !== null || world.heightAt(x, z) !== null,
  });
  const outbidCrown = createOutbidCrown(landmarks);
  const unmountLandmarks = foundation.mountGeometry(landmarks);
  const googleTiles = createGoogleTiles({ scene, renderer, landmarks, frame: world.manifest.frame,
    low: foundation.tier === 'low', roadAnchor: (x, z) => world.nearestRoad(x, z, 100),
  });
  const visualGround = withLandmarkSurfaces({ heightAt: world.surfaceHeightAt }, landmarks);
  const sceneryWorld = {
    get graph() { return world.graph; }, heightAt: visualGround.heightAt, roadHeightAt: world.roadHeightAt, collides: world.collides,
    get collisionRevision() { return world.collisionRevision; },
  };
  // Cold load (gtasf-cold-load): the whole-city street-prop layout, billboards and road details cost
  // seconds of phone CPU, so normal play builds them right after READY; cinematic/harness runs wait.
  let streetProps: Awaited<ReturnType<typeof createStreetProps>> = null;
  let parodyBillboards: Awaited<ReturnType<typeof createParodyBillboards>> = null;
  let roadDetails: Awaited<ReturnType<typeof createRoadDetails>> = null;
  // Shared founder-ladder city billboards (other players' startups rotate through city slots); flag-gated.
  let founderCityBillboards: ReturnType<typeof createFounderCityBillboards> | null = null;
  let founderPlazaInvestor: Awaited<ReturnType<typeof createFounderPlazaInvestor>> | null = null;
  let founderMemeNpcs: ReturnType<typeof createFounderMemeNpcs> | null = null;
  let founderDriveQuest: ReturnType<typeof createFounderDriveQuest> | null = null;
  let founderShareQuest: ReturnType<typeof createFounderShareQuest> | null = null;
  let founderDemoDay: ReturnType<typeof createFounderDemoDay> | null = null;
  let founderFollowers: ReturnType<typeof createFounderFollowers> | null = null;
  let cofounderRecruits: ReturnType<typeof createCofounderRecruits> | null = null; // gtasf-sstf8
  const jobsDoneToday = new Set<string>(); // giverDoneToday
  // LANE C missions (docs/PLAN-gta-pivot.md): the client runner + the in-game phone, and the runner's current
  // objective mirrored so the E-handler, the minimap letter marker and the phone can all read it. Flag-gated.
  // gtasf-j7wvv: completions that need the world peer (mission / trial / pilgrimage / drive) wait out a reconnect (up to
  // 8 s) instead of hitting 409 not-connected: a trial submitted in the drop was 'Not counted', and the per-frame retries
  // spammed 409 console errors. The run itself survives the drop server-side (grace + persistence).
  const worldFetch: typeof fetch = async (input, init) => {
    for (let waited = 0; !connected && waited < 8000; waited += 100) await new Promise(resolve => setTimeout(resolve, 100));
    return fetch(input, init);
  };
  let founderMissionRunner: ReturnType<typeof createFounderMissionRunner> | null = null;
  let taxiFarePassenger: TaxiFarePassenger | null = null; // taxiFarePassenger (gtasf-l9j3r): the Drive a Fare passenger
  let missionPresentation: MissionPresentation | null = null; // GTA-style title slab / objective line / PASSED band (critic #17)
  let pilgrimageTracker: PilgrimageTracker | null = null; // LANE C task 6: SF pilgrimage landmark claims
  // Quest-giver phone call: rings once per SF day per device, ~90 s into free roam, for a funded player (see the loop).
  let phoneCall: PhoneCall | null = null, callAt = 0, ringQuestGiver: (() => Promise<void>) | null = null;
  // Uncollected landmarks as ★ on the minimap/map (redrawn on each collected-set change).
  const syncLandmarkMarkers = () => radar?.setLandmarks(pilgrimageTracker?.sites().filter(s => !s.collected).map(s => placePoint(s.site)) ?? []);
  let missionPhone: MissionPhone | null = null;
  let missionObjective: { mission: MissionSpec; objective: MissionObjective; index: number; waypoint: { x: number; z: number } | null } | null = null;
  let founderMissionGivers: ReturnType<typeof createFounderMissionGivers> | null = null;
  let stampPlaceNames: Map<string, string> | null = null; // id→name cache for the phone's stamp collectibles (task 6)
  // Draws another shooter's server-validated shot (a remote player, or SFPD return fire): tracer + gunshot. Assigned
  // once combat VFX mount, so a shot broadcast during boot is simply skipped (no TDZ on the later const).
  let renderRemoteShot: ((from: [number, number, number], to: [number, number, number], hit: boolean, weapon: number) => void) | undefined;
  // SFPD on foot (flag sfpdOnFoot): the server's OFFICERS list goes here once the officer pool exists (TDZ-safe).
  let officerSink: ((entries: readonly PoliceOfficerEntry[]) => void) | undefined;
  // TDZ-safe: WELCOME arrives during boot, before `combat` is created; this is replaced once it exists.
  let combatStartedNow: () => boolean = () => false;
  // Vehicle damage (flag vehicleDamage): S2C EXPLOSION goes here once the vehicle FX exist (TDZ-safe).
  let explosionSink: ((x: number, y: number, z: number) => void) | undefined;
  // Police ramming (flag policeRam): the server says a cruiser hit my car; shove it along this direction.
  let policeRamSink: ((dirX: number, dirZ: number) => void) | undefined;
  let serverPoliceSight: boolean | undefined; // gtasf-abijv: WANTED_SIGHT (undefined until an updated server sends it)
  // Health + armour pickups (flag vitalsPickups): server vitals + pickup availability, TDZ-safe sinks.
  let vitalsSink: ((health: number, armour: number) => void) | undefined;
  let pickupSink: ((index: number, available: boolean) => void) | undefined;
  const pickupBacklog = new Map<number, boolean>(); // PICKUP_STATE that arrives before the pickups mount
  let wantedWatch = 0, lastEscapeCheck = 0; // latest wanted level from the server WANTED broadcast (lane B); feeds the heist escape
  // LANE C time trials (docs/PLAN-gta-pivot.md): the runner + the race-timer HUD + the daily leaderboard panel;
  // the current run state is mirrored for the minimap 'T' markers. Flag-gated behind `timeTrials`.
  let founderTimeTrialRunner: ReturnType<typeof createTimeTrialRunner> | null = null;
  let streetRaceClient: StreetRaceClient | null = null; // LANE C multiplayer: live street races at the 'T' markers
  let bountyClient: BountyClient | null = null; // LANE C multiplayer: the Most Wanted founder bounty marker
  let coopHeistClient: CoopHeistClient | null = null; // LANE C multiplayer: join a heist as the getaway driver
  let timeTrialHud: TimeTrialHud | null = null;
  let timeTrialBoard: TimeTrialLeaderboard | null = null;
  let timeTrialState: TimeTrialState | null = null;
  let timeTrialGhostRacer: ReturnType<typeof createGhostRacer> | null = null;
  let timeTrialRunStartMs = 0; // performance.now() at run start, for the ghost racer's live elapsed
  let timeTrialGhost: GhostData | null = null; // the personal-best ghost being raced (for the HUD "vs best" delta)
  let timeTrialPromptId: string | null = null; // which trial start we last prompted at (debounce the "press E" hint)
  let seriesAPitchCard: PitchCard | null = null;
  // Phase-5 meme pitch: a tap pitch card per meme NPC, created lazily on the E-interaction and reused.
  const memePitchCards = new Map<string, PitchCard>();
  let unmountStreetProps: (() => void) | undefined, unmountParodyBillboards: (() => void) | undefined;
  let sceneryDisposed = false;
  // LANE C jobs layer (missions runner + jobs phone, SF pilgrimage, time trials). It needs no street props or whole-city
  // graph, so it mounts at the START of loadScenery (~400 ms after READY) instead of after the props layout + compile —
  // under load that wait reached tens of seconds and an E at a 'T' fell through to the car prompt (gtasf-gdx4z).
  let jobsMounted = false;
  const mountJobs = () => {
    if (jobsMounted) return; jobsMounted = true;
    // actionOpening: the Pear VC partner is the first person the player talks to (~10 s in), so mount it here, early,
    // not with the deferred scenery (~25 s) — otherwise the player pitches an empty spot (review 2026-10-15).
    if (flags.actionOpening && flags.founderLadder && flags.pitching && avatarTemplate && !sceneryDisposed) {
      void createFounderPlazaInvestor({ template: avatarTemplate, root: landmarks,
        world: { surfaceHeightAt: (x, z) => world.surfaceHeightAt(x, z), ensureAround: point => world.ensureAround(point) },
        faceToward: placePoint(FERRY) })
        .then(npc => { if (sceneryDisposed) npc.dispose(); else founderPlazaInvestor = npc; })
        .catch(error => console.warn('Founder plaza investor could not load.', error));
    }
    // LANE C missions (docs/PLAN-gta-pivot.md): the client mission runner + the in-game phone (jobs list). Both
    // are headless of the 3D scene (the authored 3D start-marker NPC lands next) — the minimap letter marker guides
    // the player to the start point and E there begins the job, the runner POSTs mission-start/complete and the
    // server validates proximity + pays the reviewed valuation credit. Flag-gated behind `missions` (off in prod).
    // LANE C SF pilgrimage (task 6): walk/drive into one of 12 landmarks → the WorldDO pays a once-ever valuation
    // credit (authoritative pose + travel anchor). Runs on its own; the jobs phone lists + routes the sites.
    if (flags.pilgrimage && !sceneryDisposed) pilgrimageTracker = createPilgrimageTracker({
      fetcher: worldFetch,
      notify: (title, detail) => toasts.show(detail ? { title, detail, tone: 'info' } : { title, tone: 'info' }),
      onProfile: profile => { fundingHud?.setProfile(profile); fundingPerks?.setProfile(profile); currentRound = profile.round; latestFundingCents = profile.currentCents ?? profile.totalCents; if (flags.lookUnlockReward) wardrobe?.refresh(); },
      sid: () => selfId,
      onChange: () => { missionPhone?.refresh(); syncLandmarkMarkers(); },
      onCollect: (siteId, collected) => trackAnalytics('pilgrimage_collect', { source: siteId, step: String(collected) }),
    });
    syncLandmarkMarkers();
    if (flags.missions && !sceneryDisposed) {
      // missionPresentation (critic #17): the GTA frame around the runner's events — title slab on start, the objective
      // as one line in the mission-text spot, MISSION PASSED with the reward counting up, MISSION FAILED otherwise.
      missionPresentation = flags.missionPresentation ? createMissionPresentation() : null;
      if (flags.taxiFareJob && flags.taxiFarePassenger && avatarTemplate) taxiFarePassenger = createTaxiFarePassenger({ template: avatarTemplate, root: landmarks,
        surfaceHeightAt: (x, z) => world.surfaceHeightAt(x, z),
        car: () => { const car = mode === 'driver' && vehicleId ? fleet.cars.get(vehicleId) : undefined; return car ? car.model : null; },
        speedMps: () => Math.abs(driving?.speed ?? 0), viewFrom: () => ({ x: camera.camera.position.x, z: camera.camera.position.z }) });
      if (flags.cofounderRecruits && flags.cofounderHunt && avatarTemplate) cofounderRecruits = createCofounderRecruits({ template: avatarTemplate, root: landmarks,
        world: { surfaceHeightAt: (x, z) => world.surfaceHeightAt(x, z), nearestRoad: (x, z, max) => world.nearestRoad(x, z, max),
          collides: (x, y, z, radius, height) => world.collides(x, y, z, radius, height) } });
      if (cofounderRecruits) (window as unknown as { __gtasfRecruits?: typeof cofounderRecruits }).__gtasfRecruits = cofounderRecruits; // QA read-only
      founderMissionRunner = createFounderMissionRunner({
        fetcher: worldFetch,
        onProfile: profile => { fundingHud?.setProfile(profile); fundingPerks?.setProfile(profile); currentRound = profile.round; latestFundingCents = profile.currentCents ?? profile.totalCents; if (flags.lookUnlockReward) wardrobe?.refresh(); },
        notify: (title, detail) => toasts.show(detail ? { title, detail, tone: 'info' } : { title, tone: 'info' }),
        onObjective: state => {
          missionObjective = state; missionPhone?.refresh(); missionPresentation?.objective(state); cofounderRecruits?.objective(state);
          if (flags.missionObjectiveRoute) routeObjective(state);
          // heistGetaway (critic N47): 'Lose the heat' had no how. Route to the nearest parked civilian car (a getaway) and say so; with
          // none close, say how to break their sight.
          if (flags.heistGetaway && state?.objective.kind === 'escape' && mode === 'on-foot') routeGetaway(true);
          if (flags.questYieldsToJob) { if (state) founderLadderFlow?.jobStarted(); else founderLadderFlow?.jobEnded(); } // critic N39: the quest card steps aside for a job
          if (taxiFarePassenger) { // the fare is a person: waits at the stand, gets in, gets out at Union Square
            if (!state || state.mission.id !== 'taxi-fare') taxiFarePassenger.end();
            else if (state.objective.id === 'pickup' && state.waypoint) {
              const stand = state.waypoint, road = world.nearestRoad(stand.x, stand.z, 40);
              taxiFarePassenger.wait(stand, road ? { x: road.x, z: road.z } : { x: foot.x, z: foot.z });
            } else if (state.objective.id === 'dropoff') taxiFarePassenger.board();
          }
        },
        quietProgress: () => missionPresentation !== null, // the slab / line / PASSED band replace the progress toasts
        // Heist escape = lose the SFPD heat when lane B's wanted is on (the grab raised it server-side); null when
        // the wanted system is off, so the runner uses its client-timed escape stub instead.
        wantedLevel: () => (flags.combat && flags.wanted) ? wantedWatch : null,
        sid: () => selfId, // bind the mission to this exact tab (two-tab fix)
        onStep: (missionId, step) => {
          trackAnalytics('mission_step', { source: missionId, step, stage: currentRound?.id });
          if (step === 'complete') cofounderRecruits?.passed(); // the crew stays at the house (gtasf-sstf8)
          // jobRideHint (critic N41, lever 3): a job whose loop is over ~1.2 km is ~10 min on foot. Started on foot, say once that a car
          // is the way round (the stops' route is drawn either way). Not the robotaxi: a quick-ride teleport resets a job server-side.
          if (step === 'start' && flags.jobRideHint && mode === 'on-foot') {
            const m = missionById(missionId);
            // The heist's escape already routes a getaway car (heistGetaway): no second 'grab a car' toast on top of it.
            if (m && !m.objectives.some(o => o.drive) && !(flags.heistGetaway && m.kind === 'heist')) {
              let prev = placePoint(m.start), loopM = 0;
              for (const o of m.objectives) if (o.at) { const p = placePoint(o.at); loopM += Math.hypot(p.x - prev.x, p.z - prev.z); prev = p; }
              const key = matchMedia('(pointer: coarse)').matches ? 'tap Enter / exit' : 'press E';
              // Name the player's own car when they have one (critic N41 acceptance: 'take the Prius').
              const own = personalCarSpot && !personalCarSpot.driving ? personalCarSpot.kind.charAt(0).toUpperCase() + personalCarSpot.kind.slice(1) : null;
              const line = own ? `The stops are spread out: take your ${own}: jobs phone, YOUR CAR, Deliver.` : `The stops are spread out: grab a car (${key} by any parked one).`;
              if (loopM > 1200) window.setTimeout(() => notify(line, 6000), 2500);
            }
          }
          if (step === 'complete' && flags.giverDoneToday) { jobsDoneToday.add(missionId); founderMissionGivers?.setDone(jobsDoneToday); }
          // taxiFarePassenger (lane D phone review): MISSION PASSED waited for nobody — it landed while the fare was still
          // seated. Hold the band until the fare has stepped out (capped at 8 s). Presentation only; the payout is the server's.
          if (step === 'complete' && missionId === 'taxi-fare' && taxiFarePassenger?.aboard) {
            if (flags.centerSlotQueue) { // critic N34: hold the whole slot (band, payout card, RANK UP) until the fare is out
              const release = centerSlot.pause(); taxiFarePassenger.whenOut(release); window.setTimeout(release, 8000);
              missionPresentation?.step(missionId, step);
            } else {
              let shown = false; const show = () => { if (shown) return; shown = true; missionPresentation?.step(missionId, step); };
              taxiFarePassenger.whenOut(show); window.setTimeout(show, 8000);
            }
          } else missionPresentation?.step(missionId, step);
        },
      });
      // "Start job" doesn't POST from the phone (mission-start is proximity-gated); it sets a GPS waypoint to the
      // job's start (map route + world guidance line, hailable) and E there kicks the runner. A far-away tap thus
      // routes the player in rather than failing with "can't start here". Also the answer to a quest-giver call.
      const routeToMission = (id: string) => {
        const mission = missionById(id); if (!mission) return;
        missionPhone?.hide();
        const p = placePoint(mission.start);
        const dest: RadarDestination = { id: `mission:${mission.id}`, title: mission.title, x: p.x, y: world.surfaceHeightAt(p.x, p.z) ?? foot.y, z: p.z, walkingStop: true };
        routeDestination(dest);
        notify(`Routing to “${mission.title}”. ${matchMedia('(pointer: coarse)').matches ? 'Tap Enter / exit' : 'Press E'} at the ${mission.start.letter} to start (or H to ride).`, 5000);
      };
      // missionObjectiveRoute (critic N41): during a job the next stop was only a letter on the minimap; legs of 80-170 s
      // with no line to follow. Route each objective like the job start (map line + world GPS line, hailable with H), and
      // clear it when the job ends, unless the player has picked another destination meanwhile.
      let routedObjective: string | null = null;
      const routeObjective = (state: typeof missionObjective) => {
        if (!state?.waypoint) {
          if (routedObjective && selectedDestination.id === routedObjective) {
            radar?.setDestination(null); guidance?.setDestination(null); selectedDestination = { ...selectedDestination, title: '' };
          }
          routedObjective = null; return;
        }
        const id = `mission-objective:${state.mission.id}:${state.index}`;
        if (id === routedObjective) return;
        const { x, z } = state.waypoint;
        const dest: RadarDestination = { id, title: state.objective.label, x, y: world.surfaceHeightAt(x, z) ?? foot.y, z, walkingStop: true };
        routedObjective = id; routeDestination(dest); // retried until routable (radarRouteRetry)
      };
      // QA read-only (job harness): which destination the game holds vs which objective it last routed.
      (window as unknown as { __gtasfRouteQa?: () => unknown }).__gtasfRouteQa = () => ({ selected: selectedDestination.id ?? selectedDestination.title, routedObjective });
      phoneCall = createPhoneCall(); callAt = performance.now() + 90_000;
      ringQuestGiver = async () => {
        // Only pitch a job that's still open today (skip the call if every one is done).
        let done: ReadonlySet<string> = new Set();
        try { const r = await fetch('/api/funding/missions', { credentials: 'same-origin' }); if (r.ok) done = new Set(((await r.json()) as { done?: string[] }).done ?? []); } catch { /* ring anyway */ }
        const calls = MISSIONS.filter(m => m.call && missionEnabled(m, flags) && !done.has(m.id));
        const mission = calls[Math.floor(Math.random() * calls.length)];
        if (!mission?.call) return;
        trackAnalytics('phone_call', { source: mission.id, outcome: 'ring' });
        phoneCall?.ring({ from: mission.call.from, line: mission.call.line,
          onAnswer: () => { trackAnalytics('phone_call', { source: mission.id, outcome: 'answer' }); routeToMission(mission.id); },
          onDecline: () => trackAnalytics('phone_call', { source: mission.id, outcome: 'decline' }) });
      };
      missionPhone = createMissionPhone({
        onStartMission: routeToMission,
        getActive: () => missionObjective ? { mission: missionObjective.mission, objective: missionObjective.objective, index: missionObjective.index } : null,
        onAbandon: () => founderMissionRunner?.cancel(),
        timeTrials: flags.timeTrials ? {
          routes: () => TIME_TRIALS,
          // Today's best per route (the board's #1; bots excluded server-side). Failures just show 'no times yet'.
          loadBests: async () => new Map((await Promise.all(TIME_TRIALS.map(async t => {
            try { const r = await fetch(`/api/time-trials/board?route=${encodeURIComponent(t.id)}`, { credentials: 'same-origin' });
              const top = r.ok ? ((await r.json()) as { records?: TimeTrialRecord[] }).records?.[0] : undefined;
              return top ? [[t.id, { name: top.name, ms: top.ms }] as const] : [];
            } catch { return []; }
          }))).flat()),
          onRoute: id => {
            const t = TIME_TRIALS.find(r => r.id === id); if (!t) return;
            const p = placePoint(t.start);
            const dest: RadarDestination = { id: `trial:${t.id}`, title: t.title, x: p.x, y: world.surfaceHeightAt(p.x, p.z) ?? foot.y, z: p.z, walkingStop: true };
            routeDestination(dest);
            const key = matchMedia('(pointer: coarse)').matches ? 'tap Enter / exit' : 'press E';
            notify(`Routing to ${t.title}. ${t.mode === 'drive' ? 'Bring a car, then' : 'On foot,'} ${key} at the T to start.`, 5000);
          },
        } : undefined,
        loadRank: flags.founderRank ? async () => { await refreshFounderRank(); return lastRank; } : undefined,
        stuntBest: flags.stuntBonus && flags.hillJumps ? () => stunts?.best ? { ...stunts.best, streets: stunts.streets } : null : undefined, // stuntBonus: best jump line
        personalCar: flags.personalCar && flags.driving ? {
          load: loadPersonalCarSpot,
          distanceTo: (x, z) => { const at = mode === 'driver' && driving ? driving : foot; return Math.hypot(x - at.x, z - at.z); },
          onRoute: (x, z) => {
            const dest: RadarDestination = { id: 'personal-car', title: 'Your car', x, y: world.surfaceHeightAt(x, z) ?? foot.y, z, walkingStop: true };
            routeDestination(dest);
          },
          deliver: deliverPersonalCar,
        } : undefined,
        // garageSlots (gtasf-n1bns, docs/PLAN-garage.md): saved-car slots 1+ under YOUR CAR.
        garage: flags.garageSlots && flags.personalCar && flags.driving ? {
          load: loadGarage,
          deliver: slot => garageAction('garage-deliver', slot),
          keep: slot => garageAction('garage-keep', slot),
          driving: () => mode === 'driver',
        } : undefined,
        loadDone: async () => {
          try { const r = await fetch('/api/funding/missions', { credentials: 'same-origin' }); if (!r.ok) return null;
            return new Set(((await r.json()) as { done?: string[] }).done ?? []); } catch { return null; }
        },
        pilgrimage: pilgrimageTracker ? {
          sites: () => pilgrimageTracker?.sites() ?? [],
          reload: () => pilgrimageTracker?.load() ?? Promise.resolve(),
          // Same GPS waypoint as "Start job": map route + world guidance line, hailable.
          onRoute: id => {
            const site = pilgrimageSiteById(id); if (!site) return;
            const p = placePoint(site);
            const dest: RadarDestination = { id: `pilgrimage:${site.id}`, title: site.name, x: p.x, y: world.surfaceHeightAt(p.x, p.z) ?? foot.y, z: p.z, walkingStop: true };
            routeDestination(dest);
            notify(`Routing to ${site.name}. Walk or drive in to collect it (a robotaxi drop on top doesn't count).`, 5000);
          },
        } : undefined,
        // Collectibles (task 6): the SF-pilgrimage stamp collection = /api/places/stamps (collected ids + total,
        // null when placeStamps is off) resolved to place NAMES via the bundled places.json (fetched once).
        loadStamps: async () => {
          try {
            const r = await fetch('/api/places/stamps', { credentials: 'same-origin' });
            if (!r.ok) return null;
            const data = await r.json() as { stamps?: string[]; total?: number };
            if (!stampPlaceNames) {
              const pr = await fetch('/data/places.json').catch(() => null);
              const pj = pr?.ok ? await pr.json() as { places?: { id: string; name: string }[] } : null;
              stampPlaceNames = new Map((pj?.places ?? []).map(p => [p.id, p.name]));
            }
            const names = (data.stamps ?? []).map(id => stampPlaceNames!.get(id) ?? id);
            return { names, total: data.total ?? names.length };
          } catch { return null; }
        },
      });
      // Authored start-marker NPC at each mission start (finished rigged avatar, not a capsule) so the start reads
      // in-world, not only as a minimap letter. Render-only; the E-interaction is the proximity check above.
      if (avatarTemplate) founderMissionGivers = createFounderMissionGivers({ template: avatarTemplate, root: landmarks,
        world: { surfaceHeightAt: (x, z) => world.surfaceHeightAt(x, z), ensureAround: point => world.ensureAround(point) },
        camera: () => camera.camera }); // giverFrustumCull (read per frame: camera is created later in boot)
      // giverDoneToday (job playthrough 10-20: after MISSION PASSED the recruiter still said 'PRESS E TO START'): label the
      // jobs already paid today. The server list once at mount; a PASSED adds to it (onStep below).
      if (flags.giverDoneToday && founderMissionGivers) void fetch('/api/funding/missions', { credentials: 'same-origin' })
        .then(r => r.ok ? r.json() as Promise<{ done?: string[] }> : null)
        .then(body => { for (const id of body?.done ?? []) jobsDoneToday.add(id); founderMissionGivers?.setDone(jobsDoneToday); }).catch(() => {});
    }
    // LANE C time trials: the client runner + the race-timer HUD + the daily leaderboard panel. E at a 'T' start
    // marker begins a run (a drive route needs a car, a foot route needs to be on foot); the runner times the
    // checkpoints and POSTs to the WorldDO (/api/funding/tt-start + tt-submit), which validates the run against the
    // authoritative pose + a server-recorded start + the server-measured elapsed, and keeps the daily board.
    // Flag-gated behind `timeTrials` (live in prod since #6.02).
    if (flags.timeTrials && !sceneryDisposed) {
      timeTrialHud = createTimeTrialHud({ onCancel: () => founderTimeTrialRunner?.cancel() });
      timeTrialBoard = createTimeTrialLeaderboard();
      timeTrialGhostRacer = createGhostRacer({ root: scene, heightAt: (x, z) => world.surfaceHeightAt(x, z) });
      founderTimeTrialRunner = createTimeTrialRunner({
        fetcher: worldFetch,
        notify: (title, detail) => toasts.show(detail ? { title, detail, tone: 'info' } : { title, tone: 'info' }),
        sid: () => selfId, // bind the run to this exact tab (two-tab fix)
        // Mark the run's start here (not in onGhost) so the ghost racer's clock stays fixed even if the champion
        // ghost swaps in mid-fetch. The racer replays against this reference.
        onState: state => { if (state && !timeTrialState) timeTrialRunStartMs = performance.now(); timeTrialState = state; timeTrialHud?.setState(state); },
        // Replay the stored personal-best ghost as a translucent racer for the run (null = none / run ended).
        onGhost: ghost => { timeTrialGhost = ghost; if (ghost) timeTrialGhostRacer?.show(ghost); else timeTrialGhostRacer?.hide(); },
        onResult: async result => {
          // Pull the fresh daily board and show it (the HUD hides itself via onState(null) when the run clears).
          try {
            const res = await fetch(`/api/time-trials/board?route=${encodeURIComponent(result.spec.id)}`, { credentials: 'same-origin' });
            if (!res.ok) return;
            const data = await res.json() as { records: readonly TimeTrialRecord[]; you: string | null };
            timeTrialBoard?.setBoard(result.spec.title, data.records, data.you ?? undefined);
            timeTrialBoard?.show();
          } catch { /* the board is cosmetic; a failed fetch just skips the panel */ }
        },
      });
    }
  };
  const loadScenery = async () => {
    mountJobs(); // first: the jobs layer doesn't wait for the scenery below
    // Whole-city props/billboards lay out on the full graph, never the spawn-area subset. [gtasf-0k01]
    await fullGraph.catch(() => {});
    const loaded = await Promise.all([
    createStreetProps({ world: sceneryWorld, landmarks, low: foundation.tier === 'low' })
      .catch(error => { console.warn('Street scenery could not load.', error); return null; }),
    createParodyBillboards({ world: sceneryWorld, low: foundation.tier === 'low' })
      .catch(error => { console.warn('Billboard scenery could not load.', error); return null; }),
    createRoadDetails({ position: initial, heightAt: visualGround.heightAt, collides: world.collides,
      drapeTriangle: foundation.tier === 'low' ? undefined : world.drapeRoadTriangle,
      isLoaded: (x, z) => world.heightAt(x, z) !== null, low: foundation.tier === 'low' })
      .catch(error => { console.warn('Road details could not load.', error); return null; }),
    ]);
    if (sceneryDisposed) { loaded[0]?.destroy(); loaded[1]?.destroy(); loaded[2]?.dispose(); return; }
    [streetProps, parodyBillboards, roadDetails] = loaded;
    // With the street layout in a worker, scenery arrives AFTER READY; first-draw shader compiles then landed as a
    // ~0.3-0.6 s phone stall (overnight Oct 7 ship-list profile). Compile the new materials hidden, then reveal.
    const roots = [streetProps?.root, parodyBillboards?.root, roadDetails?.root].filter((r): r is NonNullable<typeof r> => Boolean(r));
    // Scripted runs (?test, ?capture=1, cinematic) load scenery before the camera exists (const, temporal dead zone):
    // skip the hidden pre-compile there and mount as before.
    const compileCamera = (() => { try { return camera.camera; } catch { return undefined; } })();
    const precompile = flags.layoutWorker && compileCamera !== undefined;
    if (precompile) for (const r of roots) r.visible = false;
    unmountStreetProps = streetProps ? foundation.mountGeometry(streetProps.root) : undefined;
    unmountParodyBillboards = parodyBillboards ? foundation.mountGeometry(parodyBillboards.root) : undefined;
    if (roadDetails) scene.add(roadDetails.root);
    // Shared founder-ladder city billboards: rotate the funding leaderboard's startups through real SF
    // billboard surfaces (server-authoritative via the leaderboard + the pure time rotation). Flag-gated.
    if (flags.founderLadder && !sceneryDisposed) {
      founderCityBillboards = createFounderCityBillboards({
        root: landmarks, world: { surfaceHeightAt: (x, z) => world.surfaceHeightAt(x, z) },
        getStartups: () => latestLeaders.map(leader => ({ id: leader.deviceId, startupName: leader.startupName, stageLabel: leader.round.label,
          tierRank: billboardRankForRound(leader.round.id) })), // economy round is the source of truth: Seed→Market St, Series A→Bay Bridge…
        low: foundation.tier === 'low',
      });
    }
    // Founder-ladder phase 2: a real VC firm partner on the Ferry plaza for the first pitch (founderLadder
    // && pitching). A fixed rigged avatar + "a partner at <firm>" label, facing the Ferry spawn. The anchor is
    // the FIXED Ferry point (not the player's spawn): createGroundNpc places the NPC near its faceToward anchor,
    // so passing the dynamic spawn made the investor follow deep-link/returning spawns across the city (it showed
    // up at the SoMa Demo Day venue). Anchoring to FERRY keeps it on the Ferry plaza for every spawn — identical
    // to the old behaviour for a normal Ferry spawn (FERRY→FOUNDER_PLAZA_ANGEL is >8 m, so it already anchored here).
    if (!flags.actionOpening && flags.founderLadder && flags.pitching && avatarTemplate && !sceneryDisposed) {
      void createFounderPlazaInvestor({ template: avatarTemplate, root: landmarks,
        world: { surfaceHeightAt: (x, z) => world.surfaceHeightAt(x, z), ensureAround: point => world.ensureAround(point) },
        faceToward: placePoint(FERRY) })
        .then(npc => { if (sceneryDisposed) npc.dispose(); else founderPlazaInvestor = npc; })
        .catch(error => console.warn('Founder plaza investor could not load.', error));
    }
    // Founder-ladder phase 5: free-roam meme-NPC side quests (fictional archetypes). Render-only for now
    // (the quest interaction + its reviewed money path land next); flag-gated behind memeQuests (off).
    if (flags.memeQuests && avatarTemplate && !sceneryDisposed) {
      founderMemeNpcs = createFounderMemeNpcs({ template: avatarTemplate, root: landmarks,
        world: { surfaceHeightAt: (x, z) => world.surfaceHeightAt(x, z), ensureAround: point => world.ensureAround(point) } });
      // Phase 5.1 drive quest (flags.driveQuest): the "escape the cone" controller (HUD + escape detection +
      // the server-verified drive-start/complete fetches). Only when the drive NPC can render.
      if (flags.driveQuest && !sceneryDisposed) founderDriveQuest = createFounderDriveQuest({
        fetcher: worldFetch,
        onProfile: profile => { fundingHud?.setProfile(profile); fundingPerks?.setProfile(profile); currentRound = profile.round; latestFundingCents = profile.currentCents ?? profile.totalCents; if (flags.lookUnlockReward) wardrobe?.refresh(); },
        notify: (title, detail) => toasts.show(detail ? { title, detail, tone: 'info' } : { title, tone: 'info' }),
        sid: () => selfId, // bind the quest to this exact tab (two-tab fix)
      });
      // Phase 5.1 share quest (flags.shareQuest): the "repost my take" card (X compose intent + once-ever claim).
      if (flags.shareQuest && !sceneryDisposed) founderShareQuest = createFounderShareQuest({
        onProfile: profile => { fundingHud?.setProfile(profile); fundingPerks?.setProfile(profile); currentRound = profile.round; latestFundingCents = profile.currentCents ?? profile.totalCents; if (flags.lookUnlockReward) wardrobe?.refresh(); },
        notify: (title, detail) => toasts.show(detail ? { title, detail, tone: 'info' } : { title, tone: 'info' }),
        shareUrl: () => referralShareUrl(locationLink({ x: spawn.x, z: spawn.z, yaw: spawn.yaw })),
      });
    }
    // Founder-ladder phase 6: the Series A Demo Day venue (flags.seriesAQuest, independent of memeQuests). The
    // fictional hacker-house MC renders here; the E-interaction opens the pitch card below (reusing the ladder
    // pitch flow, vcId=FOUNDER_SERIES_A_ID) when seriesAQuestReady. Off in prod with the flag.
    if (flags.founderLadder && flags.seriesAQuest && avatarTemplate && !sceneryDisposed) {
      founderDemoDay = createFounderDemoDay({ template: avatarTemplate, root: landmarks,
        world: { surfaceHeightAt: (x, z) => world.surfaceHeightAt(x, z), ensureAround: point => world.ensureAround(point) } });
      // Cosmetic teammate crew, hired on a credited Series A close (openSeriesAPitch onDone); trails the player.
      founderFollowers = createFounderFollowers({ template: avatarTemplate, root: landmarks,
        world: { surfaceHeightAt: (x, z) => world.surfaceHeightAt(x, z) } });
    }
    // gtasf-6w9a: LiDAR roofs prototype blocks (flag lidarRoofs; no-op otherwise).
    void createLidarRoofs({ heightAt: (x, z) => world.surfaceHeightAt(x, z), atlas: foundation.facadeAtlas, low: foundation.tier === 'low' }).then(lidar => { if (lidar && !sceneryDisposed) scene.add(lidar.root); }, () => {});
    // grantAveLanterns: red lantern strings across Grant Ave through Chinatown (no-op unless the flag is on).
    const grantLanterns = createGrantAveLanterns({ graph: sceneryWorld.graph, heightAt: (x, z) => world.surfaceHeightAt(x, z) });
    if (grantLanterns && !sceneryDisposed) scene.add(grantLanterns.root);
    if (precompile && compileCamera) {
      // compileAsync collects (visible) materials synchronously, then waits for the driver; hide again before awaiting
      // so the render loop never draws (and synchronously compiles) them in between.
      const pending = roots.map(r => { r.visible = true; const p = renderer.compileAsync(r, compileCamera, scene).catch(() => {}); r.visible = false; return p; });
      await Promise.all(pending);
      if (sceneryDisposed) return;
      // Upload textures ahead too, then reveal one root per frame so first-draw buffer uploads don't stack in one frame.
      const textures = new Set<import('three').Texture>();
      for (const r of roots) r.traverse(o => { const m = (o as { material?: unknown }).material; for (const mat of Array.isArray(m) ? m : m ? [m] : [])
        for (const v of Object.values(mat as object)) if ((v as { isTexture?: boolean })?.isTexture) textures.add(v as import('three').Texture); });
      for (const t of textures) renderer.initTexture(t);
      for (const r of roots) { await new Promise(resolve => requestAnimationFrame(resolve)); if (sceneryDisposed) return; r.visible = true; }
    }
  };
  addEventListener('pagehide', () => { sceneryDisposed = true; }, { once: true });
  // The harness object exists in production (testingHarness is on); only a scripted ?test= / ?capture=1 run
  // drives it, and only those (plus cinematic) need scenery before READY. [gtasf-ce5s]
  const scriptedRun = Boolean(harness) && (params.has('test') || params.get('capture') === '1');
  if (cinematicRequested || scriptedRun) await loadScenery();
  const plazaFurniture = createPlazaFurniture({ landmarks, low: foundation.tier === 'low',
    heightAt: visualGround.heightAt, isLoaded: (x, z) => world.heightAt(x, z) !== null,
    roadHeightAt: world.roadHeightAt,
    collides: (x, y, z, radius) => Boolean(authoredCollisionSurface.collidesCircle?.(x, z, radius)) || world.collides(x, y, z, radius),
  });
  const unmountPlazaFurniture = plazaFurniture ? foundation.mountGeometry(plazaFurniture.root) : undefined;
  // Flying parody ads (founder feedback, gtasf-more-billboards-sky-ads-hyvs): blimp + banner planes.
  const skyAds = createSkyAds({ low: foundation.tier === 'low' });
  const unmountSkyAds = skyAds ? foundation.mountGeometry(skyAds.root) : undefined;
  if (cinematicRequested) {
    const cinematic = await createCinematic({ scene, world, landmarks, params, enabled: flags.cinematicCapture });
    if (!cinematic) throw new Error('Cinematic mode could not initialize.');
    if (flags.outbidCrown) {
      const response = await fetch('/api/outbid', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Cinematic crown HTTP ${response.status}`);
      const value = await response.json() as { snapshot?: unknown };
      outbidCrown.setSnapshot(value.snapshot);
    }
    updateLandmarkTerrain(landmarks, world.surfaceHeightAt, (x, z, m) => world.nearestRoad(x, z, m));
    let seconds = 0, previousFrame = performance.now();
    const resizeCinematic = () => { foundation.resize(innerWidth, innerHeight); cinematic.resize(innerWidth, innerHeight); };
    const updateCinematic = (dt: number, now: number) => {
      beginHeavyFrame(); // gtasf-3k35: reset the per-frame heavy-stage grant for the cinematic loop too.
      seconds = harness?.state.capture ? now / 1000 : seconds + dt;
      cinematic.update(dt, seconds); plazaFurniture?.update(cinematic.camera.position, now); streetProps?.update(cinematic.camera.position, now);
      parodyBillboards?.update(cinematic.camera.position, now); roadDetails?.update(cinematic.camera.position); skyAds?.update(dt, now);
      canvas.dataset.ready = 'true';
    };
    const renderCinematic = () => {
      googleTiles?.update(cinematic.camera, cinematic.camera.position, performance.now());
      foundation.render(cinematic.camera, true, seconds);
    };
    resizeCinematic(); addEventListener('resize', resizeCinematic);
    loading.hidden = true; canvas.style.visibility = 'visible'; canvas.dataset.mode = 'cinematic';
    updateCinematic(0, 0);
    if (harness) harness.run({ world: { cinematic },
      async prepare(_dt, now) { await cinematic.prepare(now / 1000); updateLandmarkTerrain(landmarks, world.surfaceHeightAt, (x, z, m) => world.nearestRoad(x, z, m)); },
      update: updateCinematic, render: renderCinematic,
    }, scenarios);
    else renderer.setAnimationLoop(now => {
      const dt = Math.max(0, (now - previousFrame) / 1000); previousFrame = now;
      updateCinematic(dt, now); renderCinematic();
    });
    addEventListener('pagehide', () => {
      renderer.setAnimationLoop(null); harness?.dispose(); cinematic.dispose(); googleTiles?.dispose();
      removeLoadingArt();
      unmountStreetProps?.(); streetProps?.destroy(); unmountPlazaFurniture?.(); plazaFurniture?.dispose();
      unmountParodyBillboards?.(); parodyBillboards?.destroy(); roadDetails?.dispose(); unmountSkyAds?.(); skyAds?.destroy(); founderCityBillboards?.dispose(); founderPlazaInvestor?.dispose(); cofounderRecruits?.dispose(); cofounderRecruits = null; founderMemeNpcs?.dispose(); founderDriveQuest?.dispose(); founderShareQuest?.dispose(); founderDemoDay?.dispose(); founderMissionGivers?.dispose(); timeTrialGhostRacer?.dispose(); founderFollowers?.dispose(); seriesAPitchCard?.destroy(); for (const card of memePitchCards.values()) card.destroy(); memePitchCards.clear();
      creatorLinks?.destroy(); outbidCrown.destroy(); unmountLandmarks(); disposeLandmark(landmarks);
      fleet.dispose(); avatarTemplate?.dispose(); world.dispose(); foundation.dispose(); removeEventListener('resize', resizeCinematic);
    }, { once: true });
    return;
  }
  loadStage(55, 'Paving the Embarcadero…');
  const spawn = await snapSpawn(world, request, (x, z, radius) => Boolean(authoredCollisionSurface.collidesCircle?.(x, z, radius)));
  performance.mark('gtasf:spawn-snapped');
  if (request.place.slug === 'ferry-building') {
    spawn.focus = new THREE.Vector3().copy(ferrySpawn(world.heightAt).lookAt);
    spawn.focus.y -= 10;
  }
  const foot: GroundPose = { x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw };
  const feet = new THREE.Vector3(foot.x, foot.y, foot.z);
  // earlyWorldSocket (gtasf-ep30n, lane C's cold-phone trace): the world socket used to open only after the rest of boot and
  // the funding-profile read (~1 s handshake + up to 2-4 s of profile on a slow night, all on the critical path to READY).
  // The server takes the nickname from the device cookie itself (fundingNickname ?? HELLO name), so open the socket as soon
  // as the spawn pose is known; everything it reports is queued in order and replayed when boot attaches its handlers.
  const earlyWorld = flags.multiplayer && flags.earlyWorldSocket && !cinematicRequested ? openWorldEarly() : undefined;
  function openWorldEarly() {
    type Handlers = { message(m: S2CMessage): void; status(text: string): void; dropped?(code: number, upMs: number): void; welcomed?(): void };
    const queued: ((h: Handlers) => void)[] = [];
    let handlers: Handlers | undefined;
    const relay = (event: (h: Handlers) => void) => { if (handlers) event(handlers); else queued.push(event); };
    let cachedName: string | null = null;
    try { cachedName = normalizeNickname(localStorage.getItem('gtasf.worldNickname') ?? ''); } catch { /* storage blocked */ }
    const socket = connectWorld({ name: cachedName ?? 'Founder', spawn: encodePose(foot),
      message: m => relay(h => h.message(m)), status: text => relay(h => h.status(text)),
      dropped: (code, upMs) => relay(h => h.dropped?.(code, upMs)), welcomed: () => relay(h => h.welcomed?.()) });
    return { socket, attach(next: Handlers) { handlers = next; for (const event of queued.splice(0)) event(next); } };
  }
  const cameraFeet = new THREE.Vector3();
  let outfitIndex = Math.floor(Math.random() * avatarOutfits.length); // varied default so remotes aren't identical (characterLooks); localStorage overrides for returning players
  // adultDefaultLook (GTA V critic #18: every player read as a kid in a hoodie + shorts): with the Meshy wardrobe loaded, a NEW
  // player starts in one of the realistic looks (jeans/blazer/bomber) instead of a hoodie palette; saved choices still win.
  // Only light/mid looks (DEFAULT_LOOK_OUTFITS): a near-black default read as a silhouette at night (N1, #6.19).
  if (flags.adultDefaultLook && DEFAULT_LOOK_OUTFITS.length) outfitIndex = DEFAULT_LOOK_OUTFITS[Math.floor(Math.random() * DEFAULT_LOOK_OUTFITS.length)]!;
  try { const raw = localStorage.getItem('gtasf.outfit'); const saved = raw?.trim() ? Number(raw) : NaN; if (Number.isSafeInteger(saved) && saved >= 0) outfitIndex = saved % avatarOutfits.length; } catch { /* Cosmetic setting works without storage. */ }
  const appearanceState = flags.characterLooks ? createAppearanceState({ fallbackOutfit: outfitIndex, legacyOutfitCount: avatarOutfits.length }) : null;
  let localAppearance = appearanceState?.current ?? { ...defaultAppearance(), outfit: outfitIndex };
  outfitIndex = localAppearance.outfit;
  const localAvatar = avatarTemplate?.createInstance(outfitIndex, appearanceState?.look, false, true), player = localAvatar?.root ?? new THREE.Group();
  scene.add(player); player.position.copy(feet); player.rotation.y = foot.yaw;
  const remotes = createRemotes(), remoteAvatars = new Map<number, AvatarInstance>(), remoteAppearance = new Map<number, number>();
  // weaponPoses (lane B, gtasf-2x1b2 follow-up): other players show the weapon they're firing (raised for 1.5 s after a
  // shot, lowered until 4 s, then hidden), so a shooter no longer looks unarmed. Keyed by remote player id.
  const remoteArmed = flags.weaponPoses && flags.weapons ? new Map<number, { weapon: WeaponId; at: number; meleeAt?: number; held?: HeldWeapon; root?: THREE.Object3D }>() : null;
  const disarmRemote = (id: number) => { const a = remoteArmed?.get(id); if (a) { a.held?.dispose(); remoteArmed!.delete(id); } };
  // Low: far remote players as one instanced silhouette draw (gtasf-c8sj).
  const peerImpostors = foundation.tier === 'low' && flags.lowPeerImpostors ? createPeerImpostors(scene) : undefined;
  // id → nickname from PLAYER_JOIN, for overhead nameplates and cap-table lookup (gtasf-5dlu/2r5r).
  const peerNames = new Map<number, string>();
  const occupants = new Map<number, { vehicleId: number; mode: PlayerMode }>();
  const localWirePose: Pose = { x: 0, y: 0, z: 0, yaw: 0, flags: 0 };
  let mode: PlayerMode = 'on-foot', vehicleId = 0, driving: DrivingState | undefined;
  // carEnterAnim (gtasf-9jl2j, critique #11): getting in/out was a one-frame teleport into/out of the seat. A client-only
  // cinematic walks the avatar to the driver's door (the model's exit node) and eases it into the seat, or out of the seat
  // and over to the kerb spot the server chose. The server's seat/exit pose is unchanged; the car holds still meanwhile.
  type SeatAnim = { kind: 'enter' | 'exit'; carId: number; t: number; from: THREE.Vector3; done?: boolean };
  let seatAnim: SeatAnim | null = null;
  const SEAT_WALK_S = .35, SEAT_SLIDE_S = .45, seatDoor = new THREE.Vector3(), seatLocal = new THREE.Vector3();
  const seatEase = (k: number) => { const c = Math.max(0, Math.min(1, k)); return c * c * (3 - 2 * c); };
  const remoteSeat = new Map<number, number>(), remoteSeatAnims = new Map<number, SeatAnim>(); // other players' last car id + cinematic
  /** One frame of an enter/exit cinematic for any avatar root: in = walk to the driver's door then ease into the seat; out =
   *  ease out to the door then walk to `to` (the player's real on-foot pose). The step is capped at 50 ms so a hitch can't
   *  swallow it. Returns the clip to play (null = the seated clip); sets anim.done on the last frame. */
  function placeSeatAnim(anim: SeatAnim, root: THREE.Object3D, car: { seat: THREE.Object3D; exit: THREE.Object3D }, dt: number, to: { x: number; y: number; z: number; yaw: number }): 'walk' | 'idle' | null {
    anim.t += Math.min(dt, .05);
    if (anim.kind === 'enter') {
      if (anim.t < SEAT_WALK_S) {
        car.exit.getWorldPosition(seatDoor);
        if (root.parent !== scene) scene.add(root);
        root.position.lerpVectors(anim.from, seatDoor, seatEase(anim.t / SEAT_WALK_S));
        root.rotation.set(0, Math.atan2(seatDoor.x - anim.from.x, seatDoor.z - anim.from.z), 0);
        return 'walk';
      }
      if (root.parent !== car.seat) car.seat.add(root);
      const k = seatEase((anim.t - SEAT_WALK_S) / SEAT_SLIDE_S);
      root.position.subVectors(car.exit.position, car.seat.position).multiplyScalar(1 - k); root.rotation.set(0, 0, 0);
      anim.done = k >= 1;
      return null;
    }
    if (anim.t < SEAT_SLIDE_S) {
      if (root.parent !== car.seat) car.seat.add(root);
      root.position.subVectors(car.exit.position, car.seat.position).multiplyScalar(seatEase(anim.t / SEAT_SLIDE_S)); root.rotation.set(0, 0, 0);
      car.exit.getWorldPosition(anim.from);
      return 'idle';
    }
    if (root.parent !== scene) scene.add(root);
    const k = seatEase((anim.t - SEAT_SLIDE_S) / SEAT_WALK_S), from = anim.from;
    root.position.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, from.z + (to.z - from.z) * k);
    // Face the way you walk (away from the car).
    root.rotation.set(0, Math.hypot(to.x - from.x, to.z - from.z) > .2 ? Math.atan2(to.x - from.x, to.z - from.z) : to.yaw, 0);
    anim.done = k >= 1;
    return 'walk';
  }
  let ejectTrafficDriver: ((carId: number) => void) | undefined; // carjack: the seated NPC driver is pulled out (set once traffic drivers exist)
  let selfId = 0, vehicleSeq = 0, connected = false;
  let lastRoofRecover = 0; // gtasf-roof-fix: rate-limit the auto-recovery when a car ends up on a roof
  let hangMs = 0, lastHangRecover = 0; // gtasf carHangRecovery: how long the driven car has hung in the air
  let cameraSafe = true, lastSend = 0, previous = performance.now(), lastCameraFrame: number | undefined;
  let introUntil = Infinity, relocation: Promise<void> | undefined, noticeUntil = 0;
  const lombard = { ...LOMBARD_SPAWN, id: 'lombard', title: 'Lombard switchbacks' };
  const ferry = { ...placePoint(FERRY), id: 'ferry-building', y: 3.328, title: 'Ferry Building' };
  // radarRouteRetry: radar.setDestination refuses AND drops a destination it can't route yet. Early in a session only the
  // near-Ferry router is up, so anything further (a SoMa job and its stops, Demo Day, a pilgrimage site, a race start) got
  // no line at all (10-20 local job run). Keep the destination selected (guidance reads radar.route every frame) and retry
  // the radar every 2 s, up to 10 min, while it is still the selected destination.
  // heistGetaway (critic N47): route the escape to a getaway car. Only STATIONARY cars (reviewer 17:5x: runs 7/9 chased a fleet
  // car that drove off before the player got there): a driverless, parked fleet car within 120 m, else a kerb-parked car the
  // server will let you steal (a road within 9 m, KERB_ROAD_M), else say how to break their sight. Re-targeted per frame below
  // if the chosen car moves > 3 m or gets a driver.
  let getawayTarget: { x: number; z: number; vehicleId?: number } | null = null;
  function routeGetaway(announce: boolean): void {
    if (!fleet || !world) return;
    const near = [...fleet.cars.values()].filter(car => !(car.data.flags & POLICE_FLAG) && vehicleEntryMode(car.data) === 'driver'
      && !car.data.driverId && Math.abs(car.data.speedCmps) < 30)
      .map(car => ({ car, d: Math.hypot(car.model.root.position.x - foot.x, car.model.root.position.z - foot.z) }))
      .filter(c => c.d < 120).sort((a, b) => a.d - b.d)[0];
    const kerb = !near && flags.kerbCarTheft ? kerbCarBodies()
      .map(k => ({ x: k.x, z: k.z, d: Math.hypot(k.x - foot.x, k.z - foot.z) }))
      .filter(k => k.d <= 120).sort((a, b) => a.d - b.d)
      .find(k => world!.nearestRoad(k.x, k.z, 9) !== null) : undefined;
    const qa = window as unknown as { __gtasfGetaway?: { x: number; z: number; kind: string } }; // QA read-only
    if (near) {
      const p = near.car.model.root.position;
      getawayTarget = { x: p.x, z: p.z, vehicleId: near.car.data.id };
      routeDestination({ id: 'getaway-car', title: 'Getaway car', x: p.x, y: p.y, z: p.z, walkingStop: true });
      qa.__gtasfGetaway = { x: p.x, z: p.z, kind: 'fleet' };
      if (announce) notify(`Getaway car ${Math.round(near.d)} m: get in and drive. Out of their sight, the heat drops.`, 6000);
    } else if (kerb) {
      getawayTarget = { x: kerb.x, z: kerb.z };
      routeDestination({ id: 'getaway-car', title: 'Getaway car', x: kerb.x, y: world.surfaceHeightAt(kerb.x, kerb.z) ?? foot.y, z: kerb.z, walkingStop: true });
      qa.__gtasfGetaway = { x: kerb.x, z: kerb.z, kind: 'kerb' };
      if (announce) notify(`Getaway car ${Math.round(kerb.d)} m: steal it (${matchMedia('(pointer: coarse)').matches ? 'Enter / exit' : 'E'}) and drive. Out of their sight, the heat drops.`, 6000);
    } else {
      getawayTarget = null;
      if (selectedDestination.id === 'getaway-car') { radar?.setDestination(null); guidance?.setDestination(null); selectedDestination = { ...selectedDestination, id: undefined, title: '' }; }
      if (announce) notify('Lose the heat: break their line of sight (an alley, or the P garage on your map).', 6000);
    }
  }
  function routeDestination(dest: RadarDestination): void {
    selectedDestination = dest; const routed = radar?.setDestination(dest); guidance?.setDestination(dest);
    if (routed || !radar || !flags.radarRouteRetry) return;
    // A refused destination leaves the radar on its OLD route (lane E 10-20: a job's next leg kept showing the 20 m line to the
    // stop just reached). Drop that stale line while we retry; guidance clears with it.
    if (radar.route) radar.setDestination(null);
    let tries = 0;
    // Up to 10 min: on the prod set a cold phone's city router took > 2 min after READY (10-20 A/B), so a 2 min cap gave up first.
    const retry = () => { if (appDisposed || selectedDestination !== dest || ++tries > 300) return; if (!radar?.setDestination(dest)) window.setTimeout(retry, 2000); };
    window.setTimeout(retry, 2000);
  }
  let selectedDestination: RadarDestination = Math.hypot(foot.x - LOMBARD_SPAWN.x, foot.z - LOMBARD_SPAWN.z) < 250
    ? { ...LOMBARD_DESTINATION, title: 'Lombard downhill' } : lombard;
  let mapOpen = false, releaseMapCursor: (() => void) | undefined;
  let eventOpen = false, releaseEventCursor: (() => void) | undefined;
  let nearbyEvent: RadarEvent | undefined; // the event the player is at, for the V/J detail-card opener (gtasf-event-card-unreachable-2kvx)
  let upcomingOpen = false, upcoming: ReturnType<typeof createUpcomingEvents> = null;
  let outbidOpen = false, releaseOutbidCursor: (() => void) | undefined;
  let outbid: ReturnType<typeof createOutbidPanel> = null;
  let fundingOpen = false, releaseFundingCursor: (() => void) | undefined;
  let fundingHud: ReturnType<typeof createFundingHud> = null;
  let fundingPerks: ReturnType<typeof createFundingPerks> = null, releasePerksCursor: (() => void) | undefined;
  let referralPanel: ReturnType<typeof createReferralPanel> = null, releaseReferralCursor: (() => void) | undefined;
  let gameOptions: ReturnType<typeof createGameOptions> | undefined, releaseOptionsCursor: (() => void) | undefined;
  let pauseMenu: ReturnType<typeof createPauseMenu> = null, releasePauseCursor: (() => void) | undefined;
  let chat: ReturnType<typeof createChat> = null, releaseChatCursor: (() => void) | undefined;
  let whatsNew: ReturnType<typeof createWhatsNew> = null;
  let voiceUi: ReturnType<typeof createVoiceUi> = null;
  let proximityVoice: ReturnType<typeof createProximityVoice> = null;
  let nameplates: ReturnType<typeof createNameplates> = null;
  let capTable: ReturnType<typeof createCapTable> = null, releaseCapTableCursor: (() => void) | undefined;
  let becomeAnAngel: ReturnType<typeof createBecomeAnAngel> = null;
  let onboarding: Awaited<ReturnType<typeof setupOnboarding>> = null;
  // Founder-ladder A/B flow (gtasf-founder-ladder-p1-ilnl); null until mounted, inert when the flag is off.
  let founderLadderFlow: Awaited<ReturnType<typeof mountFounderLadder>> | null = null;
  let guidedOpener: GuidedOpener | null = null; // gtasf-dzrrn: the first-run move → car → drive tutorial
  let founderCrown: ReturnType<typeof createFounderCrown> | null = null;
  // The leaderboard payload is the top FUNDING_BOARD_LIMIT; only a shorter page is the whole field (else 'of N' lies).
  const FUNDING_BOARD_LIMIT = 50;
  let crownBoardTotal: number | null = null;
  // When a scripted ladder pitch (Pre-seed/Seed) is fired, suppress the big funding toast for a short
  // window: the cheque is shown in the ladder card itself, and the award arrives async over the socket —
  // it can land after the card has closed (modalOpen already false), so a modal-open check alone misses
  // it and the toast flashes behind the next card. The grace covers that race; free-roam cheques (well
  // after the scripted spine hands over) still toast normally.
  let founderPitchGraceUntil = 0;
  let founderBillboard: FounderBillboard | null = null;
  let founderBillboardShot: string | null = null;
  let emailCapture: ReturnType<typeof createEmailCaptureIntegration> = null;
  let tutorial: ReturnType<typeof createTutorialDriver> | null = null, tutorialBeacon: ReturnType<typeof createTutorialBeacon> | null = null;
  let lastInputMs = performance.now(), onboardingFirstRound = false;
  let friendsPanel: ReturnType<typeof createFriendsPanel> | null = null, releaseFriendsCursor: (() => void) | undefined;
  let identityScreen: ReturnType<typeof createIdentityScreen> | null = null;
  let unnamedPayoutNudged = false;
  let wardrobe: ReturnType<typeof createWardrobe> = null, releaseWardrobeCursor: (() => void) | undefined;
  let adSlotPage: ReturnType<typeof createAdSlotPage> = null, releaseAdSlotCursor: (() => void) | undefined;
  let adSlotMarkers: ReturnType<typeof createAdSlotMarkers> = null;
  let latestLeaders: readonly FundingLeader[] = [];
  let collectedEvents: ReturnType<typeof createCollectedEvents> | null = null;
  // Radar friends feed (gtasf-radar-friends-feed-d7br, option B per WildSpring/pane 13): a separate
  // layer from WS peers — poll /api/friends/presence and plot online friends as role:'friend' pins.
  // Cross-zone correct (presence fans across cells) + no username broadcast. Fail-soft + dormant until
  // flags.friends ships, so no fetch runs while it is off.
  const friendsRadarClient = flags.friends ? createFriendsClient() : null;
  let friendPresence: readonly FriendPresence[] = [];
  let lastFriendPoll = 0;
  let eventSubmit: ReturnType<typeof createEventSubmit> = null;
  let feedback: ReturnType<typeof createFeedback> = null;
  let pendingCapture: ((url: string | null) => void) | null = null;
  let trafficControls: ReturnType<typeof createTrafficControls> | undefined;
  const carContact = createCarContact(), contactBodies: ContactBody[] = [];
  const carNudges = new Map<number, { x: number; z: number; vx: number; vz: number }>();
  // Police ramming (flag policeRam): a decaying sideways shove on my own car + crunch + shake (the damage is server-side).
  const ramShove = { vx: 0, vz: 0 };
  policeRamSink = (dirX, dirZ) => {
    if (mode !== 'driver' || !driving) return;
    ramShove.vx += dirX * RAM_SHOVE_MPS; ramShove.vz += dirZ * RAM_SHOVE_MPS; driving.speed *= .6;
    playCrunch(1); cameraShake = Math.max(cameraShake, .38); cameraShakeUntil = performance.now() + 500;
  };
  let cameraShake = 0, cameraShakeUntil = 0;
  let shotFeel: ShotFeel | undefined; // critique #7 (flag shootingFeel): bloom, recoil, hit-marker, hurt vignette, flinch
  let stopSirenBed: (() => void) | undefined; // critique #8 (flag sampledAudio): distant sirens while wanted
  let policeBarks: PoliceBarks | undefined; // critique #16 (flag policePresence): SFPD barks + dispatch radio line
  const stunts = flags.stuntBonus && flags.hillJumps ? createStuntTracker() : null; // stuntBonus (critique cheap staples)
  let seriesAOffered = false; // phase 6 surfacing: the Demo Day card is offered at most once per session
  let lateKerb: Parameters<typeof takeKerbCar>[0] | undefined; // gtasf-b4wtu: the kerb car of the last steal attempt
  const engineVoice = flags.sampledAudio ? createLoopVoice('engine') : null; // critique #8: your car's engine, pitched by speed
  const skids = flags.drivingFeel ? createSkids(scene) : null; // critique #10: tyre smoke + skid marks
  let skidCar: SkidInput | null = null;
  const carContactStats = { hits: 0, last: null as null | { id: number; closing: number; speedAfter: number } };
  const reducedMotionShake = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const surface: MovementWorld = withLandmarkSurfaces({
    heightAt: (x, z) => world.surfaceHeightAt(x, z, driving?.y ?? foot.y),
    collidesCircle: (x, z, radius) => kerbCarBlocks(x, z, radius) || world.collides(x, world.surfaceHeightAt(x, z, driving?.y ?? foot.y) ?? foot.y, z, radius),
  }, landmarks);
  // gtasf-h2qrw: the drawn LOD terrain sits up to ~1.5 m off the coarse collision field on steep hills (Coit summit:
  // field 89.35 m, mesh 90.05 m, camera 89.65 m), so clearing the chase camera against the field alone left it UNDER
  // the rendered hill, looking through back-face-culled terrain at the Bay. Clear against whichever is higher on the
  // player's deck (flag cameraRenderedGround; off = the field alone, as before).
  const cameraGround = (x: number, z: number): number | null => {
    const ground = surface.heightAt(x, z);
    if (ground === null) return null;
    const drawn = world.renderedGroundHeightAt(x, z, ground);
    return drawn === null ? ground : Math.max(ground, drawn);
  };
  const camera = new ThirdPersonCamera({ walkable: { heightAt: cameraGround }, occluders: createMapCameraCollision(world, fleet.cars, () => vehicleId), activity: { camera() { introUntil = 0; } }, invertY: () => isInvertLook() });
  camera.setOrbit(foot.yaw + Math.PI, -.15);
  let followFov = camera.camera.fov;
  const actions = createActions();
  if (flags.aimControls) camera.setAimTuning(1.5, 0.35); // aimControls: crisper, finer aim camera (scales with aim weight)
  const input = flags.unifiedInput ? new Input(canvas, { actions, inVehicle: () => mode === 'driver' }) : undefined;
  const keyboard = flags.onFoot && !input ? bindKeyboard(actions) : undefined;
  const pointer = flags.onFoot && !input ? bindPointer(canvas, actions) : undefined;
  let mx = 0, mz = 0, run = false;
  let tankControls = false;
  try { tankControls = localStorage.getItem('gtasf.onFootControls') === 'tank'; } catch { /* Private browsing may disable storage. */ }
  let movementYaw = camera.yaw, previousMoveX = 0, previousMoveZ = 0;
  const movementSetting = document.querySelector<HTMLButtonElement>('#movement-mode')!;
  const toggleMovementSetting = () => {
    tankControls = !tankControls; input?.release(); keyboard?.release();
    try { localStorage.setItem('gtasf.onFootControls', tankControls ? 'tank' : 'camera'); } catch { /* Setting still works for this visit. */ }
  };
  function changeAppearance(value: Appearance) {
    localAppearance = appearanceState?.set(value) ?? value;
    outfitIndex = localAppearance.outfit;
    syncAppearance(true); gameOptions?.refresh();
  }
  const nextOutfit = () => {
    if (!flags.characterPolish) return;
    outfitIndex = (outfitIndex + 1) % avatarOutfits.length; localAvatar?.setOutfit(outfitIndex);
    changeAppearance({ ...localAppearance, outfit: outfitIndex });
    try { localStorage.setItem('gtasf.outfit', String(outfitIndex)); } catch { /* Cosmetic setting works for this visit. */ }
    gameOptions?.refresh();
  };
  actions.on('move', value => { mx = value.x; mz = value.z; run = value.run; });
  let taxiPicker: ReturnType<typeof createRobotaxiPicker> | undefined;
  let quickRide: ReturnType<typeof createQuickRide> | undefined;
  let taxiEvents: readonly RadarEvent[] = [];
  // Founder-ladder Seed quest: the next robotaxi arrival resolves (or an aborted ride rejects) this,
  // so the controller can show the Seed pitch card once the swoop drops the player at the VC office.
  let seedRide: { resolve: () => void; reject: (error: Error) => void } | null = null;
  const hasModal = () => Boolean(taxiPicker?.isOpen) || Boolean(quickRide?.active) || Boolean(pauseMenu?.isOpen) || mapOpen || eventOpen || upcomingOpen || outbidOpen || fundingOpen || Boolean(fundingPerks?.isOpen) || Boolean(referralPanel?.modalOpen) || Boolean(gameOptions?.modalOpen) || Boolean(chat?.modalOpen) || Boolean(whatsNew?.isOpen) || Boolean(eventSubmit?.isOpen) || Boolean(feedback?.isOpen) || Boolean(becomeAnAngel?.isOpen) || Boolean(identityScreen?.isOpen) || Boolean(wardrobe?.isOpen) || Boolean(capTable?.isOpen) || Boolean(adSlotPage?.isOpen) || Boolean(friendsPanel?.element.open) || Boolean(voiceUi?.isOpen) || isRecoveryDialogOpen() || isEmailDialogOpen() || admissionBlocked() || Boolean(founderLadderFlow?.modalOpen) || Boolean(seriesAPitchCard?.isOpen) || [...memePitchCards.values()].some(card => card.isOpen);
  function closeInspectionDialogs(except?: 'cap' | 'ad' | 'friends' | 'recovery' | 'email') {
    pauseMenu?.hide(); taxiPicker?.hide(); voiceUi?.hide();
    if (except !== 'cap') capTable?.close();
    if (except !== 'ad') adSlotPage?.close();
    if (except !== 'friends') friendsPanel?.close();
    if (except !== 'recovery') closeRecoveryDialogs();
    if (except !== 'email') closeEmailDialogs();
  }
  const offRecoveryDialog = onRecoveryDialogChange(open => {
    input?.release(); keyboard?.release();
    if (open) {
      closeInspectionDialogs('recovery');
      radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); whatsNew?.close(); eventSubmit?.close(); feedback?.close(); becomeAnAngel?.close();
    }
  });
  const offEmailDialog = onEmailDialogChange(open => {
    input?.release(); keyboard?.release();
    if (open) {
      closeInspectionDialogs('email');
      radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); whatsNew?.close(); eventSubmit?.close(); feedback?.close(); becomeAnAngel?.close();
    }
  });
  actions.on('look', value => { if (!hasModal()) { camera.look(value.dx, value.dy); movementYaw = camera.yaw; } });
  actions.on('recenter', () => { if (!hasModal()) { camera.recenter(foot.yaw); introUntil = 0; movementYaw = camera.yaw; } });
  actions.on('zoom', value => { if (!hasModal()) camera.zoom(value); });
  const toasts = createToasts();
  // Founder Rank (flag founderRank, critique #20): read-only XP/level from the ledgers (GET /api/funding/rank) on the
  // crown chip; refreshed on boot and whenever the valuation rises (every XP source pays a cheque); RANK UP notice on a
  // level change (the last seen level is remembered per browser so a reload doesn't re-announce it).
  let rankTimer: ReturnType<typeof setTimeout> | undefined, rankSeenCents = '', rankSplash: RankUpSplash | null = null;
  let lastRank: { level: number; title: string; into: number; span: number } | null = null;
  async function refreshFounderRank(): Promise<void> {
    try {
      const r = await fetch('/api/funding/rank', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return;
      const rank = await r.json() as { level: number; title: string; into: number; span: number; xp: number };
      lastRank = rank; founderCrown?.setRank(rank);
      let last = 0; try { last = Number(localStorage.getItem('gtasf.rank.level') ?? 0); } catch { /* storage blocked */ }
      if (last && rank.level > last) {
        // Centre splash (critic 03:35) — after any open pitch conversation closes, so it never stacks on the cheque count-up.
        const announce = () => { if (document.body.classList.contains('gt-convo-open')) { setTimeout(announce, 400); return; } (rankSplash ??= createRankUpSplash()).show(rank.level, rank.title); };
        announce();
      }
      try { localStorage.setItem('gtasf.rank.level', String(rank.level)); } catch { /* storage blocked */ }
    } catch { /* rank is cosmetic */ }
  }
  // personalCar (critique #20): the player's own car (the last road car they drove and left; server-saved per device).
  // Its spot feeds the radar blip + the jobs phone row; refreshed on join (the server re-parks it), after leaving a car
  // you drove (it just became yours) and after "Deliver my car".
  type PersonalCarSpot = { kind: string; x: number; z: number; live: boolean; driving: boolean };
  let personalCarSpot: PersonalCarSpot | null = null, personalCarMode = 'on-foot';
  let personalCarTimer: ReturnType<typeof setTimeout> | undefined;
  async function loadPersonalCarSpot(): Promise<PersonalCarSpot | null> {
    if (!flags.personalCar || !flags.driving) return null;
    try {
      const r = await fetch(`/api/funding/personal-car${selfId ? `?sid=${selfId}` : ''}`, { credentials: 'same-origin', cache: 'no-store' });
      if (r.ok) personalCarSpot = ((await r.json()) as { car?: PersonalCarSpot | null }).car ?? null;
    } catch { /* keep the last spot */ }
    return personalCarSpot;
  }
  const schedulePersonalCar = (ms: number) => { if (personalCarTimer) clearTimeout(personalCarTimer); personalCarTimer = setTimeout(() => void loadPersonalCarSpot(), ms); };
  async function deliverPersonalCar(): Promise<string> {
    const r = await fetch('/api/funding/personal-car-deliver', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid: selfId }) });
    const body = await r.json().catch(() => ({})) as { status?: string; retryInS?: number; car?: PersonalCarSpot };
    if (body.status === 'delivered' && body.car) { personalCarSpot = body.car; return 'Delivered to the nearest road — look for the blue car on your map.'; }
    switch (body.status) {
      case 'cooldown': return `Your car’s on its way — try again in ${body.retryInS ?? 60}s.`;
      case 'wanted': return 'Lose the cops first.'; // reviewer [3]: no delivered car while wanted
      case 'no-car': return 'No car yet: drive any car and leave it, and it’s yours.';
      case 'in-vehicle': return 'Get out of the vehicle first.';
      case 'taken': return 'Someone else is driving your car right now!';
      case 'no-road': case 'blocked': return 'No clear road ahead — face a street and try again.';
      default: return 'Couldn’t reach your car. Try again.';
    }
  }
  // garageSlots (gtasf-n1bns): the jobs phone's 'My garage'. The GET also places any reached tier's gift car (server-side,
  // once per device + tier); each new gift gets a centre-slot toast.
  const GARAGE_KIND: Record<string, string> = { prius: 'Prius', tesla: 'Tesla', subaru: 'Subaru', supercar: 'Supercar' };
  async function loadGarage(): Promise<{ slots: number; cars: { slot: number; kind: string; source: string; hidden: boolean; giftLabel?: string }[] } | null> {
    if (!flags.garageSlots) return null;
    try {
      const r = await fetch(`/api/funding/garage?sid=${selfId}`, { credentials: 'same-origin' });
      if (!r.ok) return null;
      const body = await r.json() as { slots: number; cars: { slot: number; kind: string; source: string; hidden: boolean; tier?: number; giftLabel?: string }[]; gifted?: { tier: number; slot: number; kind: string }[] };
      for (const car of body.cars) if (car.tier !== undefined) car.giftLabel = LOOK_TIERS[car.tier]?.label; // 'Prius · Seed gift'
      for (const gift of body.gifted ?? []) {
        const show = () => toasts.show({ title: 'NEW CAR IN YOUR GARAGE', detail: `${LOOK_TIERS[gift.tier]?.label ?? 'New tier'}: a ${GARAGE_KIND[gift.kind] ?? 'car'} · call it from your jobs phone`, tone: 'info' });
        if (flags.centerSlotQueue) centerSlot.enqueue({ naturalMs: 3200, order: 3, show, hide: () => {} }); else show();
      }
      return body;
    } catch { return null; }
  }
  async function garageAction(path: 'garage-deliver' | 'garage-keep', slot: number): Promise<string> {
    const r = await fetch(`/api/funding/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot, sid: selfId }) });
    const body = await r.json().catch(() => ({})) as { status?: string; reason?: string; retryInS?: number; car?: PersonalCarSpot };
    if (path === 'garage-keep') {
      if (body.status === 'kept') return `Kept in slot ${slot + 1}.`;
      switch (body.status === 'rejected' ? body.reason : body.status) {
        case 'not-driving': return 'Get in a car first.';
        case 'owned': return 'That’s someone else’s car.';
        case 'kind': return 'Taxis, buses and robotaxis stay on the road.';
        case 'slot': return 'That slot isn’t open yet.';
        default: return 'Couldn’t keep this car. Try again.';
      }
    }
    if (body.status === 'delivered') { if (body.car) personalCarSpot = body.car; return 'Delivered to the nearest road — look for the blue car on your map.'; }
    switch (body.status) {
      case 'cooldown': return `A car’s already on its way — try again in ${body.retryInS ?? 60}s.`;
      case 'wanted': return 'Lose the cops first.';
      case 'hidden': return 'Locked: raise your round again to use this slot.';
      case 'no-car': return 'That slot is empty.';
      case 'in-vehicle': return 'Get out of the vehicle first.';
      case 'taken': return 'Someone is driving your car right now!';
      case 'no-road': case 'blocked': return 'No clear road ahead — face a street and try again.';
      default: return 'Couldn’t reach your garage. Try again.';
    }
  }
  function scheduleFounderRank(totalCents: string): void {
    if (totalCents === rankSeenCents) return;
    const rose = rankSeenCents !== '' && BigInt(totalCents) > BigInt(rankSeenCents); rankSeenCents = totalCents;
    if (!rose) return;
    if (rankTimer) clearTimeout(rankTimer);
    rankTimer = setTimeout(() => void refreshFounderRank(), 1500); // after the cheque's ledger write settles
  }
  // LANE C Most Wanted bounty (flags.mostWantedBounty; needs combat + open PvP): marker + notices; the server pays.
  // Created up front (not with the deferred scenery): the server sends the current bounty once, on join.
  if (flags.mostWantedBounty && flags.combat && flags.openPvp) bountyClient = createBountyClient({
    notify: (title, detail) => toasts.show(detail ? { title, detail, tone: 'info' } : { title, tone: 'info' }),
    refreshProfile: () => { for (const ms of [500, 3000]) setTimeout(() => void funding?.refreshProfile(), ms); },
  });
  // LANE C live street races (flags.streetRaces): host at a 'T', invites, countdown, server placings (no valuation).
  // Created up front with the toasts (not with the deferred scenery), so a just-joined player doesn't miss an invite.
  if (flags.streetRaces && flags.timeTrials) streetRaceClient = createStreetRaceClient({
    sid: () => selfId,
    notify: (title, detail) => toasts.show(detail ? { title, detail, tone: 'info' } : { title, tone: 'info' }),
    routeTo: spec => {
      const p = placePoint(spec.start);
      const dest: RadarDestination = { id: `race:${spec.id}`, title: spec.title, x: p.x, y: world.surfaceHeightAt(p.x, p.z) ?? foot.y, z: p.z, walkingStop: true };
      routeDestination(dest);
    },
    busy: () => Boolean(founderTimeTrialRunner?.running || founderMissionRunner?.running) || hasModal(),
  });
  // LANE C co-op heist (flags.coopHeist): invites arrive whenever someone nearby starts the heist, so this is up front too.
  if (flags.coopHeist && flags.missions) coopHeistClient = createCoopHeistClient({
    sid: () => selfId,
    notify: (title, detail) => toasts.show(detail ? { title, detail, tone: 'info' } : { title, tone: 'info' }),
    busy: () => Boolean(founderMissionRunner?.running || founderTimeTrialRunner?.running || streetRaceClient?.racing) || hasModal(),
    refreshProfile: () => { for (const ms of [500, 3000]) setTimeout(() => void funding?.refreshProfile(), ms); },
  });
  // Combat cost note (flag combatCostToast): after a SERVER-applied death/bust debit, say what it cost, GTA-style
  // ("Hospital bill" / "Bail"). Diffs the valuation the HUD showed before against the post-debit refresh.
  // Combat funnel analytics (flag combatAnalytics): one 'combat_step' event per milestone, no PII.
  const combatStep = (step: string, source?: string, stage?: string) => {
    if (flags.combatAnalytics) trackAnalytics('combat_step', { step, ...(source ? { source } : {}), ...(stage ? { stage } : {}) });
  };
  const combatCostNote = (label: string, beforeCents: string | undefined) => {
    if (!flags.combatCostToast || beforeCents === undefined) return;
    const after = funding?.profile?.totalCents; if (after === undefined) return;
    const cost = fundingCents(beforeCents) - fundingCents(after);
    if (cost > 0n) notify(`${label}: −${formatFunding(cost.toString())}`, 5000);
  };
  const notify = (text: string, ms = 3500) => {
    if (statusLine.textContent !== text) {
      statusLine.textContent = text;
      statusLine.scrollTop = 0;
    }
    statusLine.dataset.notice = 'true'; noticeUntil = performance.now() + ms;
    if (flags.hud) toasts.notice(text, ms);
  };
  let net: ReturnType<typeof connectWorld> | undefined;
  let mayhem: ReturnType<typeof createMayhemController> | null = null;
  const taxi = createRobotaxiClient({
    send: message => net?.send(message) ?? false,
    notify,
    getMode: () => mode,
    onQuick(message) {
      closeInspectionDialogs(); radar?.toggleMap(false); upcoming?.toggle(false); gameOptions?.hide(); hud?.hideEvent();
      fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); chat?.hide(); wardrobe?.hide(); whatsNew?.close(); eventSubmit?.close(); feedback?.close(); becomeAnAngel?.close();
      camera.setOrbit(foot.yaw + Math.PI, camera.pitch); introUntil = 0;
      quickRide?.start(message); input?.release(); keyboard?.release();
      if (flags.eventRideDrive && flags.robotaxiJump && message.quick) startRideCinematic();
    },
    onEnd(arrived) {
      quickRide?.end(arrived);
      if (!arrived) endRideCinematic();
      if (seedRide) { const ride = seedRide; seedRide = null; arrived ? ride.resolve() : ride.reject(new Error('ride ended')); }
    },
    resolveDestination(target) {
      return resolveRobotaxiDestination(world!, target);
    },
  });
  const clearRemotes = () => { for (const id of [...(remoteArmed?.keys() ?? [])]) disarmRemote(id); peerImpostors?.clear(); remotes.clear(); for (const avatar of remoteAvatars.values()) avatar.dispose(); remoteAvatars.clear(); remoteAppearance.clear(); occupants.clear(); peerNames.clear(); remoteRides?.destroy(); remoteSeat.clear(); remoteSeatAnims.clear(); };
  let markConnected: () => void = () => {};
  const ready = new Promise<void>(resolve => { markConnected = resolve; });
  // sfGeneralArrival: a respawn (client kill, or a server kill/bust CORRECTION) lands on the snapped road's yaw with the
  // pre-death camera orbit, so it can face anywhere. Frame the hospital arrival instead: the respawn heading (north)
  // puts the brick wards left and the SF GENERAL monument + ambulance bay right.
  const faceHospitalArrival = (heading: number) => { foot.yaw = headingToYaw(heading); camera.setOrbit(foot.yaw + Math.PI, -.15); };
  const faceSfGeneralArrival = () => faceHospitalArrival(SF_GENERAL_RESPAWN.heading);
  // nearestHospitalRespawn (critic N20): name the hospital a WASTED/BUSTED player wakes at. correct() only notes it (it
  // can run before combat exists, via the early world socket); the frame loop says it when the death card lifts.
  let pendingWake: string | null = null, wasDead = false;
  let arrivalRefaceUntil = 0; // eventRideArrival: re-face the event once if the exit CORRECTION lands after the cut
  function correct(pose: Pose) {
    const target = decodePose(pose);
    let wakeHeading: number | undefined; // the hospital's wake view, applied once the pose lands (below)
    if (flags.nearestHospitalRespawn && Math.hypot(target.x - foot.x, target.z - foot.z) > 100) {
      const frame = world!.manifest.frame, hospital = nearestHospital(target, (lat, lon) => projectLocation(lat, lon, frame));
      const p = projectLocation(hospital.lat, hospital.lon, frame);
      if (Math.hypot(target.x - p.x, target.z - p.z) < 400) { pendingWake = hospital.name; wakeHeading = hospital.heading; } // the server snaps within 400 m
    }
    const respawned = flags.sfGeneralArrival && Math.hypot(target.x - foot.x, target.z - foot.z) > 100 && (() => {
      const p = projectLocation(SF_GENERAL_RESPAWN.lat, SF_GENERAL_RESPAWN.lon, world!.manifest.frame);
      return Math.hypot(target.x - p.x, target.z - p.z) < 80;
    })();
    // The driver owns their own car: ignore routine server corrections so normal driving never
    // rubber-bands or stalls; only snap on a genuine desync (far off). On-foot corrections apply as before.
    if (mode === 'driver' && driving) {
      if (Math.hypot(target.x - driving.x, target.z - driving.z) <= 4 && Math.abs(target.y - driving.y) <= 3) return;
      Object.assign(driving, target); driving.visualY = target.y; driving.speed = 0; driving.slip = 0;
    }
    Object.assign(foot, target);
    if (wakeHeading !== undefined) faceHospitalArrival(wakeHeading); // face the monument at all four (critic 5e4e2200)
    else if (respawned) faceSfGeneralArrival();
    else if (performance.now() < arrivalRefaceUntil && mode === 'on-foot') { arrivalRefaceUntil = 0; faceRideDestination(); } // eventRideArrival: late exit pose
    if (world!.heightAt(foot.x, foot.z) === null && !relocation) {
      loading.hidden = false; loadingDetail.textContent = 'Loading your location…';
      relocation = world!.ensureAround(foot).then(() => { loading.hidden = true; }).catch(error => { if ((error as { name?: string })?.name !== 'AbortError') notify(String(error)); }).finally(() => { relocation = undefined; });
    }
  }
  // Cosmetic preferences apply locally even offline; earned tiers come from the funding profile.
  let currentRound: FundingRound | undefined;
  let latestFundingCents: string | undefined; // current (burned) valuation, for the shop's ≤10% price cap preview
  let acquihireArmedUntil = 0; // acquihireConfirm: a second E before this buys
  let lastAppearanceRound = '';
  function syncAppearance(force = false) {
    if (appearanceState) {
      appearanceState.setRound(currentRound); localAppearance = appearanceState.current;
      localAvatar?.applyLook(appearanceState.look);
    }
    // meshyTierDress (20c): the round's tier garment on the player's own Meshy body (no-op on the template body).
    if (flags.meshyTierDress && currentRound) localAvatar?.setTier?.(tierForRound(currentRound).index);
    if (!(flags.characterLooks || flags.personalRides) || !net || !currentRound) return;
    if (!force && currentRound.id === lastAppearanceRound) return;
    lastAppearanceRound = currentRound.id;
    const stageRound = Math.max(0, FUNDING_ROUNDS.findIndex(r => r.id === currentRound!.id));
    net.send({ type: 'SET_APPEARANCE', appearance: encodeAppearance({ ...localAppearance, stageRound }) });
  }
  function message(m: S2CMessage) {
    taxi.message(m);
    chat?.receive(m);
    proximityVoice?.receive(m);
    if (m.type === 'WELCOME') voiceUi?.hide();
    if (m.type === 'PLAYER_LEAVE') voiceUi?.playerLeft(m.id);
    if (m.type === 'WELCOME') { selfId = m.id; connected = true; clearRemotes(); mode = 'on-foot'; vehicleId = 0; driving = undefined; seatAnim = null; correct(m.pose); markConnected();
      if (flags.personalCar) schedulePersonalCar(2500); void outbid?.refresh(); void collectedEvents?.refresh(); syncAppearance(true);
      if (!openingCarAsked) { openingCarAsked = true; net?.send({ type: 'OPENING_CAR', yaw: ((Math.round(foot.yaw / (Math.PI * 2) * 256) % 256) + 256) % 256 }); // critique #13: start in a car
        // Review LOW: the server can refuse the car (world opening-car cap, a vehicle in the way) — never a silent wait.
        setTimeout(() => { if (!appDisposed && mode === 'on-foot') notify(`No car this time. ${input?.touch.visible ? 'Tap Enter / exit' : 'Press E'} at any car, or walk: Pear VC is at the Ferry Building.`, 7000); }, 4000); }
      // A reconnect/resume is a fresh server peer: re-confirm the combat opt-in so it stays a valid target (PvP, bust).
      if (combatStartedNow()) net?.send({ type: 'COMBAT_READY' }); }
    if (m.type === 'SNAPSHOT') for (const entry of m.entries) if (entry.id !== selfId) remotes.push(entry, m.serverT);
    if (m.type === 'PLAYER_JOIN') peerNames.set(m.id, m.name);
    if (m.type === 'PLAYER_LEAVE') { disarmRemote(m.id); remoteSeat.delete(m.id); remoteSeatAnims.delete(m.id); peerImpostors?.release(m.id); remotes.remove(m.id); remoteAvatars.get(m.id)?.dispose(); remoteAvatars.delete(m.id); occupants.delete(m.id); peerNames.delete(m.id); remoteAppearance.delete(m.id); remoteRides?.remove(m.id); }
    // Cache before the first pose too, so late-created avatars receive the complete relayed look.
    if (m.type === 'APPEARANCE') {
      remoteAppearance.set(m.id, m.appearance);
      const appearance = decodeAppearance(m.appearance), avatar = remoteAvatars.get(m.id);
      if (flags.characterLooks) avatar?.applyLook(resolveLook(appearance));
      else avatar?.setOutfit(appearance.outfit % avatarOutfits.length);
      if (flags.meshyTierDress) avatar?.setTier?.(tierForRound(FUNDING_ROUNDS[appearance.stageRound] ?? FUNDING_ROUNDS[0]!).index);
    }
    if (m.type === 'MAYHEM_FIRE' && flags.playfulMayhem && m.senderId !== selfId) {
      const effect = mayhem?.receive(m, foot, performance.now());
      if (effect) foundation.mayhem?.fire(effect);
    }
    // Server-validated combat hit on us: reflect server-owned health / show WASTED (server already charged + respawns us).
    // Other shooters' shots (players in open PvP, SFPD return fire): our own were already drawn locally.
    if (m.type === 'COMBAT_HIT' && m.shooterId !== selfId && (m.shooterId < POLICE_ID_BASE || flags.policeFire)) renderRemoteShot?.(m.origin, m.to, m.targetId !== 0, m.weapon);
    if (remoteArmed && m.type === 'COMBAT_HIT' && m.shooterId !== selfId && m.shooterId < POLICE_ID_BASE) {
      const weapon = WEAPON_ORDER[m.weapon];
      // meleeSwing: a remote punch / bat swing plays on their avatar too (the victim saw a statue); fists have no mesh.
      const melee = weapon === 'fists' || weapon === 'bat', meleeAt = melee && flags.meleeSwing ? performance.now() : undefined;
      if (weapon && (weapon !== 'fists' || meleeAt !== undefined)) { const a = remoteArmed.get(m.shooterId); if (a) { a.weapon = weapon; a.at = performance.now(); a.meleeAt = meleeAt; } else remoteArmed.set(m.shooterId, { weapon, at: performance.now(), meleeAt }); }
    }
    if (shotFeel && m.type === 'COMBAT_HIT' && m.targetId) {
      const now = performance.now();
      if (m.shooterId === selfId && m.targetId !== selfId) shotFeel.hitConfirmed(m.killed, now); // my shot landed
      if (m.targetId === selfId && m.damage > 0) { shotFeel.hurt(m.damage, now); selfHurtGrunt(m.damage, now); cameraShake = Math.max(cameraShake, .12 + Math.min(.25, m.damage / 60)); cameraShakeUntil = now + 140; }
      else if (m.targetId !== selfId) { shotFeel.flinch(m.targetId, now); if (m.damage > 0) otherHurtGrunt(m.to[0], m.to[2], foot, now); }
    }
    if (m.type === 'COMBAT_HIT' && m.targetId === selfId) {
      combat?.serverHit(m.damage, m.killed);
      if (m.killed) combatStep('wasted', m.shooterId >= POLICE_ID_BASE ? 'sfpd' : 'player');
      // The server debits −2% after broadcasting the kill: refresh the HUD $ once it has (and again in case D1 lagged).
      if (m.killed) {
        const before = funding?.profile?.totalCents;
        for (const ms of [2000, 6000]) setTimeout(() => void funding?.refreshProfile().then(() => { if (ms === 6000) combatCostNote('Hospital bill', before); }), ms);
      }
    }
    if (m.type === 'WANTED') {
      policeBarks?.onWanted(m.level);
      if (m.level > wantedWatch) combatStep('wanted', undefined, String(m.level));
      if (m.level > 0 && wantedWatch === 0) { // founder playtest: say how to lose the stars, once per device
        let shown = false;
        try { shown = localStorage.getItem('gtasf.wantedHint') === '1'; localStorage.setItem('gtasf.wantedHint', '1'); } catch { /* private mode */ }
        // Critic N2: one message at a time — wait for the first DISPATCH line (4.8 s) to clear, and only if still wanted.
        if (!shown) setTimeout(() => { if (wantedWatch > 0) notify(flags.wantedEscape
          ? 'Lose the cops: break line of sight until the SEARCHING bar fills. Garages (P on radar) hide you; a respray shop (R) clears you; swapping cars throws them off.'
          : 'Lose the cops: break their line of sight. Stars flash while hidden; stay out of the radar circle.', 8000); }, 5200);
      }
      if (m.level === 0) radar?.setPoliceSearch(null);
      if (m.level === 0 && flags.wantedEscape) combat?.setEscape(null); // gtasf-66lvh: no escape bar at 0 stars
      if (flags.sampledAudio) { // critique #8: a bed of distant sirens while you're wanted
        if (m.level > 0 && !stopSirenBed) stopSirenBed = loopSample('sirens-distant', .28);
        else if (m.level === 0 && stopSirenBed) { stopSirenBed(); stopSirenBed = undefined; }
      }
      wantedWatch = m.level; combat?.setWanted(m.level);
    }
    if (m.type === 'OFFICERS' && flags.sfpdOnFoot) officerSink?.(m.entries);
    if (m.type === 'EXPLOSION' && flags.vehicleDamage) explosionSink?.(m.x / 100, m.y / 100, m.z / 100);
    if (m.type === 'POLICE_RAM' && flags.policeRam) policeRamSink?.(m.dirX, m.dirZ);
    if (m.type === 'WANTED_SIGHT') { // gtasf-abijv: the server's line-of-sight verdict + where they're searching
      serverPoliceSight = m.seen;
      radar?.setPoliceSearch(!m.seen && wantedWatch > 0 ? { x: m.x / 100, z: m.z / 100, r: POLICE_SIGHT_M } : null);
    }
    if (m.type === 'WANTED_ESCAPE' && flags.wantedEscape) { // gtasf-66lvh: server escape phase → HUD stars/bar + clear toast
      const phase = (['seen', 'evading', 'searching'] as const)[m.phase] ?? null;
      if (m.progress >= 255) {
        combat?.setEscape(null);
        notify(m.cover & 4 ? 'Fresh paint. The SFPD lost your description.' : 'You lost the cops.', 4000);
      } else {
        const hint = m.cover & 1 ? 'hidden in a garage' : m.cover & 2 ? 'outrunning them' : m.cover & 4 ? 'respray: lose them first' : '';
        combat?.setEscape(wantedWatch > 0 ? phase : null, m.progress / 254, m.remainingDs / 10, hint);
      }
    }
    if (m.type === 'COMBAT_VITALS' && (flags.vitalsPickups || flags.pedMelee || flags.healthRegen)) combatStartedNow() && vitalsSink?.(m.health, m.armour);
    if (m.type === 'PICKUP_STATE' && flags.vitalsPickups) { if (pickupSink) pickupSink(m.index, m.available); else pickupBacklog.set(m.index, m.available); }
    if (m.type === 'BUSTED' && flags.policeBust) { // sent after the server's −5% debit
      const before = funding?.profile?.totalCents;
      combatStep('busted');
      combat?.serverBusted(); setTimeout(() => void funding?.refreshProfile().then(() => combatCostNote('Bail', before)), 500);
    }
    if (m.type === 'OUTBID_CHANGED') void outbid?.refresh();
    if (m.type === 'QUEST') { streetRaceClient?.onQuest(m.json); bountyClient?.onQuest(m.json); coopHeistClient?.onQuest(m.json); }
    if (m.type === 'VEHICLE_SNAPSHOT') fleet.sync(m.entries, m.serverT);
    if (m.type === 'VEHICLE_STATE') {
      if (m.mode === 'on-foot') occupants.delete(m.playerId); else occupants.set(m.playerId, { vehicleId: m.vehicleId, mode: m.mode });
      if (m.playerId === selfId) {
        const wasMode = mode, wasVehicle = vehicleId;
        mode = m.mode; vehicleId = mode === 'on-foot' ? 0 : m.vehicleId; driving = undefined; introUntil = 0;
        if (flags.carEnterAnim) { // gtasf-9jl2j: cars only (bus/cable-car doors and seats differ); a far-off seat (a ride drop) stays a cut
          const seatCar = fleet.cars.get(mode === 'on-foot' ? wasVehicle : m.vehicleId), carLike = seatCar && seatCar.data.kind !== 'bus' && seatCar.data.kind !== 'cable-car';
          seatAnim = null;
          if (carLike && wasMode === 'on-foot' && mode !== 'on-foot' && seatCar.model.exit.getWorldPosition(seatDoor).distanceTo(player.getWorldPosition(seatLocal)) < 8) {
            seatAnim = { kind: 'enter', carId: m.vehicleId, t: 0, from: seatLocal.clone() };
            ejectTrafficDriver?.(m.vehicleId);
          } else if (carLike && wasMode !== 'on-foot' && mode === 'on-foot') seatAnim = { kind: 'exit', carId: wasVehicle, t: 0, from: new THREE.Vector3() };
        }
        if (mode !== 'on-foot') rideSystem?.dismount(); // can't be on a personal ride while in a car
        const car = fleet.cars.get(m.vehicleId);
        if (mode === 'driver') {
          if (lateKerb) { takeKerbCar(lateKerb); lateKerb = undefined; } // gtasf-b4wtu: a slow kerb seat: keep the prop hidden
          driving = createDrivingState(car ? decodePose(car.data) : foot);
          if (flags.rideAnyVehicle && car && (car.data.flags & 0x20)) driving.speed = car.data.speedCmps / 100;
          vehicleSeq = 0; camera.setOrbit(driving.yaw + Math.PI, -.15);
        }
        if (mode === 'on-foot') scene.add(player);
        const getOff = input?.touch.visible ? 'Tap EXIT RIDE to get off.' : 'Press E to get off.'; // critic N30: name the button a phone shows
        notify(mode === 'driver' ? (input?.touch.visible ? 'You’re driving. Steer with the stick · GO / BRAKE · Enter / exit to get out' : 'You’re driving. WASD · Space to brake · E to exit') : mode === 'passenger' ? car?.data.kind === 'cable-car' ? `Riding ${sampleCableCar(vehicleId, net?.clock.serverNow() ?? Date.now())?.title ?? 'the cable car'}. ${getOff}` : car?.data.kind === 'bus' ? `Riding the bus. ${getOff}` : `Sit back. Your robotaxi is driving. ${getOff}` : 'Back on foot.');
      }
    }
    if (m.type === 'CORRECTION') correct(m.pose);
  }
  // The Pear VC partner takes E within MISSION_ARRIVE_RADIUS_M — but the Ferry starter car is parked ~5 m from them,
  // so the NEARER of partner and car wins (the prompt used to read 'Get in and drive' while E opened the pitch).
  // actionOpening: the partner's plaza anchor counts before the (deferred) investor model has mounted.
  function preSeedPitchWins(): boolean {
    const pearAt = founderPlazaInvestor?.position ?? (flags.actionOpening ? placePoint(founderPlazaAngel(flags.guidedOpener)) : null);
    if (!pearAt || !founderLadderFlow?.preSeedPitchEligible) return false;
    const toPartner = Math.hypot(foot.x - pearAt.x, foot.z - pearAt.z);
    if (toPartner > MISSION_ARRIVE_RADIUS_M) return false;
    const car = fleet.nearest(foot)?.model.root.position;
    return !car || toPartner <= Math.hypot(foot.x - car.x, foot.z - car.z);
  }
  function enterExit() {
    radio?.unlock(); // Real entry gesture primes audio before the server confirms the vehicle.
    if (!net || !connected) { notify('Connecting to the city…'); return; }
    if (mode !== 'on-foot') {
      if (net.send({ type: 'VEHICLE_EXIT', vehicleId }) && flags.rideAnyVehicle && mode === 'passenger') notify('Getting off at a safe road spot…');
      return;
    }
    // A fresh parody-angel pitch takes E; an already-pitched one falls through to the car (the
    // prompt already shows "— already pitched"), so standing near one never blocks driving.
    const angelTarget = angels?.nearest(foot);
    // Living map pitching (gtasf-y5vc): only FICTIONAL roaming angels take spoken pitches. Real-person
    // celebrity NPCs are never voice/AI-pitched — they fall through to their one-tap pre-written pitch below.
    if (flags.pitching && angelTarget?.roaming && !angelTarget.alreadyPitched) { notify(`${matchMedia('(pointer: coarse)').matches ? 'Hold 🎙' : 'Hold V'} and pitch ${angelTarget.npc.name} out loud.`, 4000); return; }
    if (angelTarget && !angelTarget.alreadyPitched) {
      const result = angels!.pitch(foot);
      if (result) {
        // Only a confirmed server response marks this investor paid; failures stay retryable.
        // The funding client's onAward owns the cash celebration.
        void angelPitch?.pitch(result);
        return;
      }
    }
    // Founder-ladder phase 5: a nearby meme NPC takes E to open its tap pitch card (quest), before the car.
    const memeTarget = founderMemeNpcs?.nearest(foot);
    if (memeTarget) {
      // A drive NPC starts "escape the cone"; a share NPC opens the "repost my take" card; pitch NPCs open the pitch card.
      if (memeTarget.spec.questKind === 'drive') founderDriveQuest?.start(memeTarget.spec);
      else if (memeTarget.spec.questKind === 'share') founderShareQuest?.start(memeTarget.spec);
      else openMemePitch(memeTarget.spec);
      return;
    }
    // Founder-ladder phase 6: the Series A Demo Day MC takes E to pitch on stage, once the round quest is open
    // (held the Seed round + the daily cooldown elapsed). Otherwise say what's actually missing: if Seed is held
    // the gate is the one-per-SF-day cooldown ("opens tomorrow"); otherwise the player hasn't reached Seed yet.
    if (founderDemoDay?.nearest(foot)) {
      if (seriesAQuestReady(currentRound?.id ?? 'bootstrapping', loadFounderSession().lastRoundCloseDay, fundingDay(Date.now()))) openSeriesAPitch();
      else if (currentRound?.id === 'seed') notify('Series A opens tomorrow — grow your valuation today.');
      else notify('Reach the Seed round first, then pitch here for Series A.');
      return;
    }
    // Founder-ladder free-roam FIRST PITCH: standing at the Pear VC plaza investor takes E to open the Pre-seed
    // pitch card — the funnel entry for returning/already-founded players who skipped the first-run spine (they
    // get the ladder cosmetics but never saw the pitch). Eligibility (ladder+pitching on, not yet closed) is owned
    // by the controller; the investor only renders with those flags on, so this is inert otherwise.
    // actionOpening: the partner's plaza anchor counts before the (deferred) investor model has mounted.
    if (preSeedPitchWins()) { founderLadderFlow!.preSeedPitch(); return; }
    // actionOpening (critique #13): E at the First Round office opens the Seed meeting once the player has driven there.
    if (founderLadderFlow?.interact(foot)) return;
    // LANE C mission start: standing at a job's start marker (and none running) takes E to begin it. The runner
    // POSTs mission-start; the server re-checks proximity from the authoritative pose before it accepts. Markers
    // only exist when `missions` is on, so this never fires in prod with the flag off.
    if (founderMissionRunner && !founderMissionRunner.running && !coopHeistClient?.crewing) { // a getaway driver's E at the H mustn't start their own heist
      const mission = MISSIONS.find(m => { if (!missionEnabled(m, flags)) return false; const p = placePoint(m.start); return Math.hypot(foot.x - p.x, foot.z - p.z) <= MISSION_ARRIVE_RADIUS_M; });
      if (mission) {
        // acquihireConfirm (critic N47, lane E prod run): Buy My Company debited 10 % of the valuation on the first E with no prompt.
        // First press names the price; a second within 6 s buys.
        if (mission.acquihire && flags.acquihireConfirm && performance.now() > acquihireArmedUntil) {
          acquihireArmedUntil = performance.now() + 6000;
          const price = latestFundingCents ? formatFunding((fundingCents(latestFundingCents) / 10n).toString()) : '10% of your valuation';
          notify(`Buy their company for ${price}? ${matchMedia('(pointer: coarse)').matches ? 'Tap Enter / exit' : 'Press E'} again to buy.`, 6000);
          return;
        }
        acquihireArmedUntil = 0; founderMissionRunner.start(mission); return;
      }
    }
    // LANE C time-trial start: standing at a 'T' marker (and no run active) takes E to begin a race; the mode comes
    // from whether the player is in a vehicle (the runner rejects the wrong one). Markers only exist with `timeTrials` on.
    if (founderTimeTrialRunner && !founderTimeTrialRunner.running && !streetRaceClient?.racing) {
      const trial = TIME_TRIALS.find(t => { const p = placePoint(t.start); return Math.hypot(foot.x - p.x, foot.z - p.z) <= MISSION_ARRIVE_RADIUS_M; });
      if (trial) { founderTimeTrialRunner.start(trial, mode !== 'on-foot'); return; }
    }
    // gtasf-gdx4z: the jobs + time-trial runners mount with the DEFERRED scenery (can be tens of seconds under load). An E
    // at a job / 'T' start before they exist must not fall through to "Walk closer to a vehicle" (QA saw exactly that).
    if ((flags.missions && !founderMissionRunner) || (flags.timeTrials && !founderTimeTrialRunner)) {
      const starts = [...(flags.timeTrials && !founderTimeTrialRunner ? TIME_TRIALS.map(t => t.start) : []),
        ...(flags.missions && !founderMissionRunner ? MISSIONS.filter(m => missionEnabled(m, flags)).map(m => m.start) : [])];
      if (starts.some(start => { const p = placePoint(start); return Math.hypot(foot.x - p.x, foot.z - p.z) <= MISSION_ARRIVE_RADIUS_M; })) {
        notify('Still loading the city — press E again in a moment.'); return;
      }
    }
    const car = fleet.nearest(foot);
    // gtasf-0lnjq: no real car in reach, but a kerb-parked one is: steal it (the server spawns it where it stands).
    const kerb = !car && flags.kerbCarTheft ? nearestKerbCar(foot.x, foot.z, KERB_STEAL_M) : undefined;
    if (kerb) {
      const yaw = ((Math.round(kerb.yaw / (Math.PI * 2) * 256) % 256) + 256) % 256;
      if (net.send({ type: 'KERB_CAR_TAKE', x: Math.round(kerb.x * 100), z: Math.round(kerb.z * 100), yaw, kind: kerb.kind === 'subaru' ? 1 : 0 })) {
        takeKerbCar(kerb); // the real car appears at the same pose
        // gtasf-b4wtu: the world DO stalls ~1-2 s every minute or so (prod tail: 0.7-1.4 s CPU events), and a 1.5 s
        // give-up raced those stalls: the server seated the player just after the client had restored the prop and said
        // "Couldn't take that car." Wait 5 s; if the seat still arrives after giving up, the VEHICLE_STATE handler re-hides it.
        lateKerb = kerb;
        setTimeout(() => { if (lateKerb !== kerb) return; lateKerb = undefined; if (mode !== 'driver') { restoreKerbCar(kerb); notify("Couldn't take that car."); } }, 5000); // refused
      }
      return;
    }
    if (!car) { notify(flags.rideAnyVehicle ? 'Walk closer to a vehicle to drive or ride.' : 'Walk closer to a parked car to drive it.'); return; }
    if (net.send({ type: 'VEHICLE_ENTER', vehicleId: car.data.id })) {
      // Carjacking a MOVING traffic car pulls its driver out (cosmetic; the server raises car-theft wanted).
      if (carjackEffect && (car.data.flags & 0x20) && Math.abs(car.data.speedCmps) > 30) {
        const p = car.model.root.position;
        carjackEffect.eject(p.x, p.y, p.z, car.model.root.rotation.y, performance.now());
        notify('Carjacked!');
      } else notify('Getting in…');
    }
  }
  function hail() {
    pauseMenu?.hide(); gameOptions?.hide();
    if (quickRide?.active) return;
    if (taxiPicker?.isOpen) { taxiPicker.hide(); return; }
    if (flags.quickRobotaxi && !taxi.active) { if (!hasModal()) taxiPicker?.show(); return; }
    if (taxi.toggle(selectedDestination)) linkedDestination.cancel();
  }
  /** The player-asked road snap (R key and the ☰ 'Return to road' button, gtasf-dtnk7): not on foot once combat is live
   *  — it would hop out of a cop's cuff radius (the server also refuses it while wanted). Auto-recovery calls recoverRoad. */
  function guardedRecoverRoad() {
    if (mode === 'on-foot' && combatStartedNow()) { if (wantedWatch > 0) notify('No road snaps while you\'re wanted. Run for it.'); return; }
    recoverRoad();
  }
  function recoverRoad() {
    if (!flags.roadRespawn || hasModal()) return;
    input?.release(); keyboard?.release();
    // Snap to the nearest loaded road locally so recovery is instant and works even before the player is
    // connected / without the server round-trip (gtasf: the hanging-car recovery must not depend on the net);
    // then let the server reconcile the authoritative pose for other players.
    const here = driving ?? foot;
    const road = world?.nearestRoad(here.x, here.z, 200);
    if (road) {
      if (mode === 'driver' && driving) {
        Object.assign(driving, { x: road.x, y: road.y, z: road.z, yaw: road.yaw, speed: 0, slip: 0,
          pitch: 0, roll: 0, vy: 0, airborne: false, landed: false, visualY: road.y, bumpVx: 0, bumpVz: 0, bumpSpin: 0 });
      }
      foot.x = road.x; foot.y = road.y; foot.z = road.z; foot.yaw = road.yaw;
      notify('Recovered to the nearest road.');
      if (connected) net?.send({ type: 'ROAD_RESPAWN' });
    } else if (connected && net?.send({ type: 'ROAD_RESPAWN' })) {
      notify('Road recovery requested.'); // no road loaded nearby yet: fall back to the server snap
    } else {
      notify('No road nearby to recover to.');
    }
  }
  // Cancelling the native share sheet / clipboard rejects with a benign AbortError — don't scare the
  // player with "The user aborted a request."; only surface real failures.
  async function share() { try { await copyLocation(driving ?? foot); notify('Location link copied.'); } catch (error) { if ((error as { name?: string })?.name !== 'AbortError') notify(String(error), 10000); } }
  const hud = createPlayableHud({ async onShareEvent(event) {
    await copyGameLink(new URL(`/go/${encodeURIComponent(event.id)}`, location.origin));
  }, onCardChange(open) {
    eventOpen = open; input?.release();
    if (open) { upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs(); releaseEventCursor ??= holdFreeCursor(); if (document.pointerLockElement) document.exitPointerLock(); }
    else { releaseEventCursor?.(); releaseEventCursor = undefined; }
  } });
  const streetHud = createStreetHud();
  // eventRideDrive (critic N19c): a client-only robotaxi drives the player ~2.5 s along the nearest road toward the event before
  // quickRide's black cut (the server still owns the relocation). The player rides hidden inside; the camera follows the car.
  type RidePoint = readonly [number, number, number];
  let rideCinematic: { car: import('./vehicles/models/vehicle').VehicleInstance; path: RidePoint[]; t: number } | null = null;
  function startRideCinematic() {
    endRideCinematic();
    const car = fleet.createLocal('robotaxi'); if (!car) return;
    // Follow the planned road route (the GPS line); fall back to the nearest road's heading toward the event.
    const planned = radar?.route;
    let path: RidePoint[] | null = planned && planned.mode !== 'walk' && planned.points.length >= 2 ? planned.points : null;
    if (!path) {
      const road = world?.nearestRoad(foot.x, foot.z, 40);
      if (!road) { car.dispose(); return; }
      const toward = selectedDestination.title ? Math.atan2(selectedDestination.x - road.x, selectedDestination.z - road.z) : foot.yaw;
      const turn = (a: number) => Math.abs(Math.atan2(Math.sin(a - toward), Math.cos(a - toward)));
      const yaw = turn(road.yaw) <= turn(road.yaw + Math.PI) ? road.yaw : road.yaw + Math.PI;
      path = [[road.x, road.y, road.z], [road.x + Math.sin(yaw) * 60, road.y, road.z + Math.cos(yaw) * 60]];
    }
    scene.add(car.root); rideCinematic = { car, path, t: 0 }; placeRideCar(rideCinematic, 0);
    player.visible = false; camera.recenter(car.root.rotation.y); movementYaw = camera.yaw;
    document.body.classList.add('gt-ride-drive'); // hides the radio-station toast for the shot (critic N19c nit)
  }
  /** Put the ride car `distance` m along its path, heading along the current segment. */
  function placeRideCar(ride: NonNullable<typeof rideCinematic>, distance: number) {
    let left = distance;
    for (let i = 1; i < ride.path.length; i++) {
      const a = ride.path[i - 1]!, b = ride.path[i]!, length = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (left <= length || i === ride.path.length - 1) {
        const f = length > 0 ? Math.min(1, left / length) : 0, x = a[0] + (b[0] - a[0]) * f, z = a[2] + (b[2] - a[2]) * f;
        ride.car.root.position.set(x, world?.surfaceHeightAt(x, z) ?? a[1] + (b[1] - a[1]) * f, z);
        if (length > 0) ride.car.root.rotation.set(0, Math.atan2(b[0] - a[0], b[2] - a[2]), 0);
        return;
      }
      left -= length;
    }
  }
  function endRideCinematic() {
    if (!rideCinematic) return;
    rideCinematic.car.root.removeFromParent(); rideCinematic.car.dispose(); rideCinematic = null; player.visible = true;
    document.body.classList.remove('gt-ride-drive');
  }
  quickRide = createQuickRide({ load: point => world!.ensureAround(point), ready: () => taxi.ready(),
    onCut() {
      endRideCinematic();
      faceRideDestination();
      // The server's exit pose (kerb step, car heading) can land just after the cut and would turn the player back to the
      // car's heading (facing 74 deg off in one local run vs 1 deg in another): re-face once if it lands soon after.
      if (flags.eventRideArrival && selectedDestination.title) arrivalRefaceUntil = performance.now() + 4000;
    } });
  // eventRideArrival (critic N19): arrive facing the event you rode to, so its marker is in view as the fade lifts.
  function faceRideDestination() {
    if (flags.eventRideArrival && selectedDestination.title) {
      const dx = selectedDestination.x - foot.x, dz = selectedDestination.z - foot.z;
      if (Math.hypot(dx, dz) > 3) {
        // Facing straight at an event across a narrow street puts the building right behind you: the chase camera pulls in to
        // ~2 m and fades the avatar (Jackson St, quickDropKerb). Take the smallest turn away from the event that leaves the
        // camera room to show the player (>= 6.5 m; the fade starts under 6 m), else the roomiest of the candidates.
        const toward = Math.atan2(dx, dz);
        let best = toward, room = camera.clearBehind(foot, toward);
        for (const offset of [.52, -.52, .87, -.87, 1.22, -1.22, 1.57, -1.57]) {
          if (room >= 6.5) break;
          const clear = camera.clearBehind(foot, toward + offset);
          if (clear > room + .5) { best = toward + offset; room = clear; }
        }
        foot.yaw = best; player.rotation.y = foot.yaw;
      }
    }
    camera.recenter(foot.yaw); movementYaw = camera.yaw; introUntil = 0;
  }
  taxiPicker = createRobotaxiPicker({
    choices() {
      const rows: TaxiChoice[] = [];
      if (selectedDestination.title) rows.push({ ...selectedDestination, group: 'Current destination' });
      // Match the visible drive-through rings, including their shared venue anchor. The raw feed
      // includes past/future events and several entries per venue that would waste nearby choices.
      const now = Date.now();
      const eventLocations = flags.venueGrouping
        ? (flags.eventFocus24h ? focusVenues(taxiEvents, { now })
          : groupVenues(taxiEvents, { now, focusWindowMs: WEEK_WINDOW_MS }).filter(venue => venue.week.length > 0))
          .flatMap(venue => {
            const event = representativeEvent(venue);
            return event ? [{ event, lat: venue.lat, lon: venue.lon }] : [];
          })
        : taxiEvents.filter(event => Number.isFinite(event.lat) && Number.isFinite(event.lon))
          .map(event => ({ event, lat: event.lat!, lon: event.lon! }));
      const nearby = eventLocations.map(({ event, lat, lon }) => {
        const point = projectLocation(lat, lon, world!.manifest.frame);
        return { ...point, y: world!.surfaceHeightAt(point.x, point.z) ?? 0, event, title: event.title, group: 'Nearby events' };
      }).sort((a, b) => Math.hypot(a.x - foot.x, a.z - foot.z) - Math.hypot(b.x - foot.x, b.z - foot.z)).slice(0, 6);
      rows.push(...nearby);
      rows.push(...PLACES.slice(0, 10).map(place => { const point = placePoint(place); return { ...point, y: world!.surfaceHeightAt(point.x, point.z) ?? 0, title: place.title, group: 'Landmarks' }; }));
      if (flags.friends) for (const friend of friendPresence) if (friend.online && friend.x != null && friend.z != null) rows.push({ x: friend.x / 100, y: 0, z: friend.z / 100, title: friend.username, friend: friend.username, group: 'Friends' });
      return rows;
    },
    quote: target => taxi.quote(target),
    hail: target => hailSelectedTaxi(target) || statusLine.textContent || 'Unable to hail right now.',
    onOpen() { input?.release(); keyboard?.release(); },
  });
  const offerStartupRecovery = (delayMs = 1500) => {
    if (!flags.accountRecovery || identityScreen?.isOpen || emailCapture?.available) return;
    // An incidental event cheque must not cover the tutorial before Founder ID is saved.
    if (onboarding && !onboarding.state.completed && ['intro', 'walk', 'drive_ring', 'identity'].includes(onboarding.state.step)) return;
    try {
      if (localStorage.getItem('gtasf.recoveryPrompted')) return;
      localStorage.setItem('gtasf.recoveryPrompted', '1');
      setTimeout(() => openSaveStartup({ getOutfit: () => String(outfitIndex) }), delayMs);
    } catch { /* storage optional; the Game-options entry still offers it */ }
  };
  const funding = createFundingClient({
    onProfile(profile) { if (flags.founderRank) scheduleFounderRank(profile.totalCents); fundingHud?.setProfile(profile); fundingPerks?.setProfile(profile); currentRound = profile.round; latestFundingCents = profile.currentCents ?? profile.totalCents; nameplates?.setLocal(profile); syncAppearance(); wardrobe?.refresh();
      // The crown's rank follows the profile too (a cheque moves it now, not at the next leaderboard poll — the
      // banner read '#87 OF 87' beside a '#9' nameplate right after Seed). Total/holder keep the last board's.
      founderCrown?.set({ rank: profile.rank ?? null, total: crownBoardTotal, crownHolder: latestLeaders[0]?.startupName ?? null }); },
    onLeaderboard: value => { fundingHud?.setLeaderboard(value); latestLeaders = value.week; nameplates?.setLeaders(value.week); nameplates?.setLocal(value.you);
      crownBoardTotal = value.week.length < FUNDING_BOARD_LIMIT ? value.week.length : null; // a full page isn't the field size
      founderCrown?.set({ rank: value.you.rank, total: crownBoardTotal, crownHolder: value.week[0]?.startupName ?? null }); },
    onError: text => notify(text, 8000),
    onAward(award, info) {
      // chequeOnce (critic N3): a cheque this device already showed (reload) runs the state hooks below but no display —
      // no big card, cha-ching, confetti, nudges or toast (the HUD counters still update via showAward's suppressed path).
      const replay = info?.replay === true;
      // While a founder-ladder card is open its own cheque display owns the moment — suppress the big
      // funding toast so it doesn't stack behind the Seed pitch/end card (phone bug). The pitch award
      // lands async, sometimes just after the card closed, so also honour the post-pitch grace window.
      // Free roam (grace elapsed, no modal) shows the toast normally.
      fundingHud?.showAward(award, replay || Boolean(founderLadderFlow?.modalOpen) || Date.now() < founderPitchGraceUntil);
      if (flags.lookUnlockReward) wardrobe?.refresh(); // a cheque can close a round: announce a newly unlocked look (critic 20c)
      // critic N35: the MISSION PASSED band showed the BASE payout (+$1,700) while this card showed the credit (+$2.2k).
      if (award.eventTitle.startsWith('Mission: ')) missionPresentation?.credit(award.eventTitle.slice('Mission: '.length), BigInt(award.amountCents));
      if (!replay) sfx?.chaChing(); // gtasf-bigk: a procedural cash-register "cha-ching" on every cheque (flag proceduralSfx)
      if (!replay) emailCapture?.onAward(award.previousRound.stars === 0 && award.profile.round.stars > 0);
      // Confetti cannon auto-fires on a round close / stage-up — a festive burst above you (playful mayhem).
      if (!replay && foundation.mayhem && award.previousRound?.id && award.profile?.round?.id && award.previousRound.id !== award.profile.round.id) {
        const at: [number, number, number] = [foot.x, foot.y + 1.8, foot.z];
        foundation.mayhem.fire({ item: 'confetti', at, colour: MAYHEM_DEFAULT_COLOUR.confetti });
        net?.send({ type: 'MAYHEM_FIRE', item: mayhemItemIndex('confetti'), at, colour: MAYHEM_DEFAULT_COLOUR.confetti, normal: null });
      }
      if (award.previousRound?.id && award.profile?.round?.id && award.previousRound.id !== award.profile.round.id) onboardingFirstRound = true; // onboarding firstRound tip
      // Onboarding: the server-validated Founder Orientation cheque clears the drive step; a real event clears the taxi step.
      if (tutorial?.onAward(award.eventId) === 'orientation') return; // the flow shows PRE-SEED CLOSED + opens the identity screen
      if (award.eventId) collectedEvents?.add(award.eventId);
      // Unnamed players are paid too now; nudge once (non-modal: an award must never grab input mid-drive).
      if (!replay && award.source === 'event' && !award.profile?.startupName && !unnamedPayoutNudged) {
        unnamedPayoutNudged = true; notify('Funded! Name your startup in Game options to put it on the leaderboard.', 9000);
      }
      // A venue cheque names only its last event; reload the other credited IDs too.
      if (flags.driveThroughFunding && award.source === 'event') void collectedEvents?.refresh();
      // A celebrity pitch already showed its parody line + cheque in enterExit; just refresh the HUD.
      if (award.source === 'celebrity' || replay) return; // chequeOnce: no toast / recovery offer on a replay
      // Founder playtest: an award must NEVER open the event card — that releases input + pointer lock
      // and stops the car. Show a non-modal SA toast; the card opens only on an explicit V / click.
      toasts.show({ title: award.eventTitle || 'Round closed', amount: `+${formatFunding(award.amountCents)}`,
        tone: 'award', detail: award.profile?.round?.label ? award.profile.round.label.toUpperCase() : 'TERM SHEET SIGNED' });
      // Once, after the first real funding round: offer to save the startup with a recovery code.
      offerStartupRecovery();
    },
  });
  const fundingRoom = createFundingRoom({ scene, surfaceHeightAt: surface.heightAt });
  // Personal rides (PLAN-v2.1, gtasf-v21-personal-rides); null + no-op until flags.personalRides is on.
  const rideSystem = flags.personalRides ? createRideSystem(scene) : null;
  // Remote players' rides, so others see you on a scooter (reuses the same meshes); null/no-op when off.
  const remoteRides = flags.personalRides ? createRemoteRides(scene) : null;
  const roundForRemote = (id: number) => {
    const appr = remoteAppearance.get(id);
    return (appr != null ? FUNDING_ROUNDS[decodeAppearance(appr).stageRound] : undefined) ?? FUNDING_ROUNDS[0]!;
  };
  const dropBanner = createDropBanner();
  const dropCheckpoint = createDropCheckpoint({ scene, surfaceHeightAt: surface.heightAt });
  const drops = createDropsClient({
    onClaim: claim => { dropBanner?.celebrate(claim); toasts.show({ title: claim.fundName, amount: `+${formatFunding(claim.amountCents)}`, tone: 'drop', detail: 'CHEQUE SECURED' }); },
    onError: text => notify(text, 8000),
  });
  drops?.init();
  const guidance = createRouteGuidance({ scene, surfaceHeightAt: surface.heightAt, raisedSurfaceAt: authoredSurface.heightAt, enabled: flags.eventNavigation,
    onArrive(event) {
      if (funding) notify(flags.driveThroughFunding ? 'Drive or walk through the marker to get funded.' : 'WORK THE ROOM · Stay in the green marker for 20 seconds.', 8000);
      else toasts.show({ title: event.title, tone: 'event', detail: 'ARRIVED · Event destination reached' });
    },
  });
  let lastLocationLabel = -Infinity;
  let lastLandmarkGround = -Infinity;
  const markers = createEventMarkers({ scene, camera: camera.camera, graphicsPreset: foundation.tier === 'low' ? 'low' : 'hd', frame: world.manifest.frame, surfaceHeightAt: surface.heightAt,
    resolvePosition(point) {
      const road = world!.nearestRoad(point.x, point.z, 200);
      if (!road) return null;
      const y = surface.heightAt(road.x, road.z);
      return y !== null && !world!.collides(road.x, y, road.z, .5) ? { x: road.x, y, z: road.z } : null;
    },
    onEnter(event) {
      nearbyEvent = event; // the V/J key opens this event's detail card (even when navigating to it)
      if (selectedDestination.event) return;
      if (funding) { void funding.selectEvent(event.id); notify(flags.driveThroughFunding ? 'Drive or walk through the marker to get funded.' : 'WORK THE ROOM · Stay in the green marker for 20 seconds.', 8000); }
      else toasts.show({ title: event.title, tone: 'event', detail: `Event reached · Open ${flags.proximityVoice ? 'J' : 'V'} for event details` });
    },
  });
  const worldEventLinks = bindWorldEventLinks({ canvas, camera: camera.camera,
    targets: () => markers?.linkTargets ?? [], canInteract: () => !hasModal(),
    hover: id => markers?.hoverEvent(id),
  });
  const linkedDestination = createLinkedDestination(request.place.eventId, event => selectEvent(event) === true);
  const walkingRouter = createWalkingRouter({
    heightAt: (x, z) => authoredSurface.heightAt(x, z) === null ? null : surface.heightAt(x, z),
    collidesCircle: surface.collidesCircle,
  }, (x, z) => world.heightAt(x, z) !== null);
  performance.mark('gtasf:radar-start');
  const coastline = await loadMapCoastline(world.manifest);
  performance.mark('gtasf:coastline-done');
  if (coastline) foundation.setCoastline(coastline); // shoreSeams: ground tone under slivers over land
  performance.mark('gtasf:shore-mask-done'); // cold-load trace: coastline-done -> here = the shore mask build (gtasf-9oe0r)
  const landmarkTops = LANDMARKS.filter(def => def.heightM >= 100).map(def => { const p = landmarkPosition(def); return { x: p.x, z: p.z, r: 45, top: (world.surfaceHeightAt(p.x, p.z) ?? p.y ?? 0) + def.heightM }; });
  const placeSigns = createPlaceSigns({ scene, frame: world.manifest.frame, heightAt: (x, z) => world.surfaceHeightAt(x, z), topAt: (x, z) => {
    // Landmark towers (Salesforce, Transamerica...) are authored meshes with no baked building box.
    for (const t of landmarkTops) if (Math.hypot(t.x - x, t.z - z) <= t.r) return t.top;
    return world.buildingTopAt(x, z);
  }, low: foundation.tier === 'low' });
  if (flags.testingHarness && placeSigns) (window as unknown as { __gtasfSigns?: unknown }).__gtasfSigns = placeSigns;
  // While the founder ladder's quest card owns the top of the screen (HUD lock), stamp notices would land on it (critic
  // 03:35: the first two stamps ARE the two pitch spots) — the stamp still records; it shows in the jobs phone.
  const placeStamps = createPlaceStamps({ frame: world.manifest.frame, notify: text => { if (!document.body.hasAttribute('data-founder-locked')) notify(text); } });
  let markFirstFrame: (() => void) | undefined; // resolved by hideLoadingCard (the first live frame)
  const firstFrame = new Promise<void>(resolve => { markFirstFrame = resolve; });
  // deferFarLandmarks (gtasf-g8ty9): build the far set once the game is on screen — sliced, placed on the ground, mounted
  // (material prep, signs, night lights) like the boot group, then moved into it so walkable surfaces, terrain re-placement
  // and landmark lookups see them. Never awaited by boot.
  if (deferredLandmarkIds.length) void firstFrame.then(async () => {
    const late = await createPlacedLandmarksSliced({ ids: deferredLandmarkIds });
    for (const landmark of late.children) {
      const definition = landmark.userData.definition as Parameters<typeof landmarkPosition>[0] | undefined;
      if (definition) landmark.position.y = landmarkPosition(definition, world.surfaceHeightAt).y;
    }
    foundation.mountGeometry(late);
    for (const landmark of late.children.slice()) landmarks.add(landmark);
    updateLandmarkTerrain(landmarks, world.surfaceHeightAt, (x, z, m) => world.nearestRoad(x, z, m));
    performance.mark('gtasf:landmarks-deferred-done');
  }).catch(error => console.warn('Far landmarks could not build.', error));
  // marketNeonLazy (#6.43 cold-READY split, 10-19): the mid-Market neon strip (night signage 1.5 km from the Ferry, no walkable
  // surfaces) is not built before READY, where it lengthened the one landmark long task on a cold phone. It is built once, when
  // the camera first comes within 700 m of it, so a Ferry spawn never pays and there is no hitch at the first frame.
  if (flags.marketNeon && flags.marketNeonLazy) void firstFrame.then(() => {
    const at = landmarkPosition(MARKET_NEON, world.surfaceHeightAt);
    const poll = window.setInterval(() => {
      const p = camera.camera.position;
      if (Math.hypot(p.x - at.x, p.z - at.z) > 700) return;
      window.clearInterval(poll);
      // Frame-paced (reviewer/critic 11:3x: no frame > ~50 ms on a 4x phone while driving in): step the strip build ~4 ms per
      // frame (it yields after every sign face / fascia / run merge), then place and mount it like the landmark path does.
      performance.mark('gtasf:market-neon-build');
      const steps = marketNeonSteps();
      const tick = () => {
        try {
          const t0 = performance.now();
          let step = steps.next();
          while (!step.done && performance.now() - t0 < 4) step = steps.next();
          performance.measure('gtasf:market-neon-slice', { start: t0 }); // per-frame cost of the paced build (hitch evidence)
          if (!step.done) { requestAnimationFrame(tick); return; }
          const m0 = performance.now();
          const neon = step.value, placed = landmarkPosition(MARKET_NEON, world.surfaceHeightAt);
          neon.position.set(placed.x, placed.y, placed.z);
          neon.rotation.y = MARKET_NEON.rotationYDeg * Math.PI / 180;
          neon.userData.definition = MARKET_NEON; neon.userData.landmarkId = MARKET_NEON.id;
          foundation.mountGeometry(neon);
          landmarks.add(neon);
          performance.measure('gtasf:market-neon-mount', { start: m0 });
          performance.mark('gtasf:market-neon-mounted');
          performance.measure('gtasf:market-neon-build', 'gtasf:market-neon-build', 'gtasf:market-neon-mounted');
        } catch (error) { console.warn('Market neon could not build.', error); }
      };
      requestAnimationFrame(tick);
    }, 2000);
  });
  const radar = createRadar({ get graph() { return world.graph; }, graphUpgraded: world.graphComplete ? undefined : fullGraph,
    // earlyRouterGraph (gtasf-ep30n N16): hand the router the full routing graph once it's decoded, not after the three
    // city-wide index builds it doesn't use, so the two interleave instead of queuing (~15 s of index slicing on a 4x phone).
    routeGraph: world.graphComplete ? world.routingGraph
      : flags.earlyRouterGraph ? graphReadySignal.then(() => world.fullRoutingGraph()) : fullGraph.then(() => world.routingGraph ?? world.graph),
    routeGraphBytes: flags.routingWorkerPacked && flags.earlyRouterGraph && !world.graphComplete ? graphReadySignal.then(() => world.fullRoadGraphBytes()) : undefined,
    nearRouteGraph: flags.nearRouterFirst && !world.graphComplete ? world.routingGraph : undefined, // spawn-area graph, already decoded
    nearRouterAt: firstFrame, // build it after the first live frame (the card is held until then), never during loading
    frame: world.manifest.frame, autoLoad: false,
    walkingRoute: walkingRouter.route, travelMode: () => mode === 'on-foot' && !taxi.active ? 'walk' : 'road',
    coastline,
    landmarks: [lombard, ...LANDMARKS.filter(place => !place.id.startsWith('lombard') && place.id !== 'castro-crossing' && place.id !== 'embarcadero-streetcar' && place.id !== 'vaillancourt-fountain').map(place => {
      const point = placePoint(place);
      return { ...point, id: place.id, title: place.name, y: world.surfaceHeightAt(point.x, point.z) ?? place.fallbackBaseM };
    })],
    quoteFare: flags.quickRobotaxi ? destination => taxi.quote(destination) : undefined,
    onSelect(destination) { tutorial?.destinationSelected(); linkedDestination.cancel(); selectedDestination = destination; guidance?.setDestination(destination); void funding?.selectEvent(destination.event?.id ?? null); notify(`Destination: ${destination.title}. Press H to hail.`); },
    onHail(destination) {
      return hailSelectedTaxi(destination) || statusLine.textContent || 'Unable to hail a robotaxi right now.';
    },
    onClear() {
      // Clear the active waypoint/route everywhere: map line (radar clears its own), world GPS line,
      // funding selection, and strip the stale event so markers/hail no longer act on it.
      linkedDestination.cancel();
      selectedDestination = { ...selectedDestination, event: undefined, title: '' };
      guidance?.setDestination(null); void funding?.selectEvent(null);
      notify('Route cleared.');
    },
    onExpandedChange(expanded) {
      mapOpen = expanded; input?.release();
      if (expanded) { upcoming?.toggle(false); hud?.hideEvent(); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs(); releaseMapCursor ??= holdFreeCursor(); }
      else { releaseMapCursor?.(); releaseMapCursor = undefined; }
    },
  });
  radar?.update(foot, foot.yaw, [], [], camera.yaw - Math.PI);
  if (funding && (radar || (markers && flags.dimCollectedMarkers))) {
    collectedEvents = createCollectedEvents({ load: () => flags.driveThroughFunding ? funding.collected() : Promise.resolve([]), onChange(ids) {
      radar?.setCollected(ids); markers?.setCollected(ids);
    } });
  }
  radar?.setDestination(selectedDestination);
  guidance?.setDestination(selectedDestination);
  let routingReady = false;
  // deferredEventPick (gtasf-dqtn2): an event chosen before the full road graph lands (~READY..+30 s) is remembered and applied
  // as soon as routing is ready, instead of 'Road directions are loading. Try again in a moment.' and a dropped pick.
  let pendingEventPick: { event: RadarEvent; hailNow: boolean } | undefined;
  void radar?.routingReady.then(() => {
    routingReady = true;
    const pick = pendingEventPick; pendingEventPick = undefined;
    if (pick) { const result = selectEvent(pick.event, pick.hailNow); if (typeof result === 'string') notify(result); }
  });
  // gtasf-sjmkk (GTA rule, server-enforced too): no robotaxi stops for a wanted player — say why instead of "unavailable".
  const WANTED_NO_TAXI = 'No robotaxi will stop while you\'re wanted. Lose the cops first.';
  function hailSelectedTaxi(target: Parameters<typeof taxi.hail>[0]): boolean {
    if (flags.wanted && wantedWatch > 0) { statusLine.textContent = WANTED_NO_TAXI; notify(WANTED_NO_TAXI); return false; }
    return selectTaxiDestination(target, { hail: destination => taxi.hail(destination), events: taxiEvents,
      select(destination) {
        linkedDestination.cancel(); selectedDestination = destination;
        radar?.setTaxiDestination(destination); guidance?.setDestination(destination);
        tutorial?.destinationSelected(); void funding?.selectEvent(destination.event?.id ?? null);
      },
    });
  }
  function selectEvent(event: RadarEvent, hailNow = false): string | boolean {
    if (event.lat === null || event.lon === null) return 'This event has no public driving location.';
    if (!routingReady && !(hailNow && flags.quickRobotaxi)) {
      if (!flags.deferredEventPick) return 'Road directions are loading. Try again in a moment.';
      pendingEventPick = { event, hailNow }; notify(`Routing to ${event.title}…`); return true;
    }
    if (hailNow && taxi.active) return 'Cancel your current robotaxi before choosing a new trip.';
    if (hailNow && flags.wanted && wantedWatch > 0) return WANTED_NO_TAXI;
    if (hailNow && mode !== 'on-foot') return 'Exit your vehicle before hailing a robotaxi.';
    const point = projectLocation(event.lat, event.lon, world!.manifest.frame);
    const target = { ...point, id: event.id, event, title: event.title, y: world!.surfaceHeightAt(point.x, point.z) ?? 0 };
    if (hailNow && flags.quickRobotaxi) {
      return hailSelectedTaxi(target) || statusLine.textContent || 'Unable to hail right now.';
    }
    let rejection: string | undefined;
    const route = radar?.setDestination(target, candidate => {
      if (!hailNow || taxi.hail({ ...target, ...candidate.approach })) return true;
      rejection = statusLine.textContent || 'Unable to hail a robotaxi right now.';
      return false;
    });
    if (!route) return rejection ?? 'This destination is outside the drivable local map. Its event page is still available.';
    tutorial?.destinationSelected();
    linkedDestination.cancel();
    selectedDestination = { ...target, ...route.approach }; guidance?.setDestination(target);
    void funding?.selectEvent(event.id);
    if (!hailNow) notify(`Destination: ${event.title}. Follow the yellow GPS route.`);
    return true;
  }
  upcoming = createUpcomingEvents({ frame: world.manifest.frame, enabled: flags.eventsView,
    quoteFare: flags.quickRobotaxi ? event => {
      const point = projectLocation(event.lat!, event.lon!, world!.manifest.frame);
      return taxi.quote({ ...point, y: world!.surfaceHeightAt(point.x, point.z) ?? 0, title: event.title, event });
    } : undefined,
    onSelect: event => selectEvent(event), onHail: event => selectEvent(event, true),
    neighbourhoodAt: point => world!.locationNameAt(point.x, point.z).neighbourhood,
    onOpenChange(open) { upcomingOpen = open; input?.release(); keyboard?.release(); if (open) { radar?.toggleMap(false); hud?.hideEvent(); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs(); eventSubmit?.close(); feedback?.close(); } },
  });
  const eventFeed = createEventFeed({
    onEvents(events) { taxiEvents = events; radar?.setEvents(events); markers?.setEvents(events); upcoming?.setEvents(events); linkedDestination.setEvents(events); },
    onError(message) { upcoming?.setError(message); },
  });
  // PLAN-v2 decision 9 (UI half): "+ Add event" paste-a-link panel. Returns null when
  // flags.eventSubmission is off. Button lives in the HUD action row; a submit refreshes the feed
  // so the new community event appears on radar/map/markers.
  eventSubmit = createEventSubmit({
    buttonParent: document.querySelector<HTMLElement>('#play-controls') ?? undefined,
    onModalChange(open) {
      input?.release(); keyboard?.release();
      if (open) { radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs(); whatsNew?.close(); feedback?.close(); }
    },
    onSubmitted() { void eventFeed?.refresh(); },
  });
  outbid = createOutbidPanel({
    onSnapshot: snapshot => outbidCrown.setSnapshot(snapshot),
    onModalChange(open) {
      outbidOpen = open; input?.release(); keyboard?.release();
      if (open) {
        radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs(); eventSubmit?.close(); feedback?.close();
        releaseOutbidCursor ??= holdFreeCursor();
        if (document.pointerLockElement) document.exitPointerLock();
      } else { releaseOutbidCursor?.(); releaseOutbidCursor = undefined; }
    },
  });
  fundingHud = funding ? createFundingHud({
    statusParent: hud?.element,
    onSaveIdentity: (startupName, nickname) => funding.saveIdentity(startupName, nickname),
    onRecover: flags.accountRecovery ? () => openRestoreStartup() : undefined,
    onRefreshLeaderboard: () => funding.leaderboard(),
    onDisplayChange: ({ profile, displayedCents }) => { hud?.setFundingProfile(profile, displayedCents); founderLadderFlow?.setValuation(displayedCents); },
    // Economy v3: continuous burn can drop a round — a non-blocking red SA toast, never a modal (FB1).
    onDownRound: (from, to) => toasts.show({ title: 'DOWN ROUND', detail: `${from} → ${to}`.toUpperCase(), tone: 'downround' }),
    onModalChange(open) {
      fundingOpen = open; input?.release(); keyboard?.release();
      if (open) {
        radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs();
        releaseFundingCursor ??= holdFreeCursor();
        if (document.pointerLockElement) document.exitPointerLock();
      } else { releaseFundingCursor?.(); releaseFundingCursor = undefined; }
    },
  }) : null;
  fundingPerks = createFundingPerks({ scene, fleet, surfaceHeightAt: surface.heightAt, parent: fundingHud?.element, notify,
    onModalChange(open) {
      input?.release(); keyboard?.release();
      if (open) {
        radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs();
        releasePerksCursor ??= holdFreeCursor();
        if (document.pointerLockElement) document.exitPointerLock();
      } else { releasePerksCursor?.(); releasePerksCursor = undefined; }
    },
  });
  referralPanel = createReferralPanel({ parent: document.querySelector<HTMLElement>('#play-controls')!,
    onModalChange(open) {
      input?.release(); keyboard?.release();
      if (open) {
        radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs();
        releaseReferralCursor ??= holdFreeCursor();
        if (document.pointerLockElement) document.exitPointerLock();
      } else { releaseReferralCursor?.(); releaseReferralCursor = undefined; }
    },
  });
  gameOptions = createGameOptions({ launcher: movementSetting, tankControls: () => tankControls, toggleMovement: toggleMovementSetting,
    outfit: flags.characterPolish && !flags.characterLooks ? { label: () => avatarOutfits[outfitIndex]!, next: nextOutfit } : undefined,
    recover: flags.roadRespawn ? guardedRecoverRoad : undefined,
    changelog: flags.changelog ? () => whatsNew?.openHistory() : undefined,
    recenter: flags.unifiedInput ? () => actions.emit('recenter', undefined) : undefined,
    onModalChange(open) {
      input?.release(); keyboard?.release();
      if (open) {
        radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs();
        trafficControls?.refresh();
        releaseOptionsCursor ??= holdFreeCursor();
        if (document.pointerLockElement) document.exitPointerLock();
      } else { releaseOptionsCursor?.(); releaseOptionsCursor = undefined; }
    },
  });
  if (flags.accountRecovery && gameOptions) {
    const save = document.createElement('button'); save.type = 'button'; save.className = 'gt-recovery-entry'; save.textContent = 'Save your startup';
    save.addEventListener('click', () => { gameOptions?.hide(); openSaveStartup({ getOutfit: () => String(outfitIndex) }); });
    const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'gt-recovery-entry'; restore.textContent = 'I already have a startup';
    restore.addEventListener('click', () => { gameOptions?.hide(); openRestoreStartup(); });
    gameOptions.content.append(save, restore);
  }
  // LANE C jobs phone on touch: N is the only desktop shortcut, so Game options carries an entry (no new thumb
  // button to overlap the run/enter/ride/paint controls). missionPhone mounts later with the scenery; read at click.
  if (flags.missions && gameOptions) {
    const jobs = document.createElement('button'); jobs.type = 'button'; jobs.className = 'gt-recovery-entry'; jobs.textContent = 'Phone: jobs & SF pilgrimage';
    jobs.addEventListener('click', () => { gameOptions?.hide(); missionPhone?.show(); });
    gameOptions.content.append(jobs);
  }
  emailCapture = createEmailCaptureIntegration({ parent: gameOptions.content, onboarding: () => onboarding,
    closeOptions: () => gameOptions?.hide(), canOpen: () => !hasModal(),
    // On foot or stopped in a vehicle (first cheques usually land while driving), after 1.5 s without input.
    canAutoPrompt: () => (mode === 'on-foot' ? Math.abs(mx) + Math.abs(mz) < .01 : Math.abs(fleet.cars.get(vehicleId)?.data.speedCmps ?? 0) < 50) && performance.now() - lastInputMs > 1500,
    onStatus: text => notify(text, 6000),
    onVerified: () => { void funding?.leaderboard().catch(() => {}); },
  });
  if (flags.traffic || flags.cableCars) trafficControls = createTrafficControls({ parent: gameOptions.content,
    setCruise: enabled => fleet.setCruiseMode(enabled), getPosition: () => foot, serverNow: () => net?.clock.serverNow() ?? Date.now(),
    onDestination(stop) {
      const target = { x: stop.x, y: stop.y, z: stop.z, id: stop.id, title: `${stop.title} · ${stop.stop}` };
      if (!radar?.setDestination(target)) { gameOptions?.setStatus('This stop is outside the available road map.'); return; }
      linkedDestination.cancel();
      selectedDestination = target; guidance?.setDestination(target); void funding?.selectEvent(null);
      gameOptions?.hide(); notify(`Destination: ${target.title}. Follow GPS to board with E.`);
    },
  });
  if (rideSystem) {
    const section = document.createElement('section'), heading = document.createElement('h3'), list = document.createElement('ul');
    section.className = 'gt-ride-unlocks'; heading.textContent = 'Personal rides · funding unlocks';
    for (const ride of PERSONAL_RIDES) {
      const row = document.createElement('li'), tier = LOOK_TIERS[ride.tierIndex]!;
      const stage = FUNDING_ROUNDS.find(round => round.id === tier.unlockRoundId)!;
      row.textContent = `${ride.label} — ${stage.label}${ride.tierIndex === 0 ? ' (available from the start)' : ''}`;
      list.append(row);
    }
    section.append(heading, list); gameOptions.content.append(section);
  }
  chat = createChat({ parent: gameOptions.content, send: message => net?.send(message) ?? false, connected: () => connected,
    onModalChange(open) {
      input?.release(); keyboard?.release();
      if (open) {
        radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); wardrobe?.hide(); closeInspectionDialogs();
        releaseChatCursor ??= holdFreeCursor();
        if (document.pointerLockElement) document.exitPointerLock();
      } else { releaseChatCursor?.(); releaseChatCursor = undefined; }
    },
  });
  const radioHud = { radioStation: '', radioPlaying: false, radioMuted: false, radioTicker: '' };
  let radio: ReturnType<typeof createRadio> = null;
  let voiceVerified = false; // set by the inline voice email verification (no reload needed)
  let spokenCaptions: ReturnType<typeof createSpokenCaptions> = null;
  let pitchHint: ReturnType<typeof createPitchHint> | undefined;
  let spokenHintShown = (() => { try { return localStorage.getItem('gtasf:spoken-hint') === '1'; } catch { return false; } })(), spokenHintCheckAt = 0;
  const updateRadioHud = () => {
    const state = radio?.state; if (!state) return;
    radioHud.radioStation = state.station; radioHud.radioPlaying = state.playing;
    radioHud.radioMuted = state.muted || state.volume === 0; radioHud.radioTicker = state.ticker;
  };
  radio = createRadio({ parent: gameOptions.content, onChange: updateRadioHud }); updateRadioHud();
  proximityVoice = createProximityVoice({ send: value => net?.send(value) ?? false,
    selfId: () => selfId, connected: () => connected, verified: () => voiceVerified || funding?.profile?.verifiedFounder !== false, // absent unless emailCapture: the server's VOICE_PUBLISH gate decides (refused-unverified)
    // Not gated on the arrival camera (introUntil stays Infinity until the first move/look): a player who enables
    // voice and holds V straight away must still talk (gtasf-ws4j: PTT silently did nothing).
    canTalk: () => !hasModal(),
    onSpeaking: (id, active) => nameplates?.setSpeaking(id, active), onDuck: active => radio?.setDuck(active),
    onHold: held => spokenCaptions?.hold(held),
    captionsHandleV: () => Boolean(spokenCaptions),
    onNotice: text => notify(text, 5000),
    // Verified speakers only (founder): an unverified hold opens the inline email + code box right there, not
    // Game options. The server re-checks verification on every publish, so the next hold transmits, no reload.
    onNeedsVerification() {
      if (isEmailDialogOpen()) return;
      // Never silent (founder Oct 6): without the inline email flow, say why holding V can't transmit.
      if (!flags.emailCapture || !emailCapture?.available) { notify('Talking needs a verified email, which is not available right now. You can still listen.', 6000); return; }
      openEmailCapture({ source: 'voice', inline: { title: 'Enter your email to talk',
        blurb: 'Voice is for verified founders. We’ll email you a 6-digit code, then hold V or the mic button to talk.' },
        onVerified: () => { voiceVerified = true; notify('Verified! Hold V or the mic button to talk.', 6000); void funding?.leaderboard().catch(() => {}); } });
    } });
  // Radio sits at ~40% whenever voice listening is on (and ducks to ~10% while anyone audible talks).
  proximityVoice?.subscribe(state => radio?.setVoiceListening(state.enabled && !state.pending));
  // Spoken bubbles (gtasf-gc9q): hold V / the mic button -> a 🎙 bubble for nearby players. For everyone (no voice
  // opt-in) behind voiceCaptions, under ?voice=1 until voicePublic. With voice on, voice's PTT drives it via onHold.
  spokenCaptions = createSpokenCaptions({ voiceActive: () => proximityVoice?.state.enabled ?? false,
    canTalk: () => !hasModal(), connected: () => connected, playerId: () => selfId,
    showSpeaking: (text, ms) => chat?.showSpeaking(text, ms), showSpeakingIfPending: (text, ms) => chat?.showSpeakingIfPending(text, ms),
    clearSpeaking: () => chat?.clearSpeaking(),
    pitchReady: () => pitchHint?.active() ?? false,
    // Living map pitching: the investor's verdict; the cheque toast arrives through the funding status poll.
    onPitch: pitch => notify(pitch.status === 'judged' ? `${pitch.score}/10: "${pitch.verdict}"${pitch.credited ? '' : ' (already pitched)'}`
      : pitch.status === 'unnamed' ? 'Name your startup first, then pitch.' : pitch.reason === 'cooldown' ? 'You already pitched them. Try another investor.' : 'Keep it clean and try again.', 7000) });
  proximityVoice?.subscribe(() => spokenCaptions?.sync());
  // Living map pitching: "Hold V / 🎙 to pitch <investor>" when on foot near an angel or VC office.
  pitchHint = flags.pitching && spokenCaptions && world ? createPitchHint({ frame: world.manifest.frame, parent: document.body,
    touch: matchMedia('(pointer: coarse)').matches, position: () => mode === 'on-foot' ? { x: foot.x, z: foot.z } : null }) : undefined;
  addEventListener('pagehide', () => pitchHint?.dispose(), { once: true });
  addEventListener('pagehide', () => spokenCaptions?.destroy(), { once: true });
  const vehicleAudio = createVehicleAudio({ enabled: flags.vehicleAudio, parent: gameOptions.content });
  const sfx = createProceduralSfx();
  // GTA V pivot — LANE B (combat & police, flag combat): the 18+ gate, health/armour HUD, and the
  // death→WASTED→respawn flow. null when flags.combat is off (byte-inert). main.ts owns the player pose,
  // so it performs the respawn teleport. v1 is a local snap to SF General (road-snapped); the authoritative
  // server respawn (a CORRECTION to SF General) lands with step 5's server-driven death — combat ships
  // flag-off and step-1 death only fires via the test hook, so no cross-city desync reaches players. [lane B]
  // Combat visuals (lane A #6): real muzzle flash / tracer / impact / blood on lane B's fire.onShot. Blood is
  // gated by flags.gore + the player gore toggle. Byte-inert off (onShot stays unset).
  // Blood also requires the 18+ acknowledgement (isGoreEnabled defaults on, so a player who chose "Play without
  // combat" would otherwise see blood from other players' hits).
  const combatVfx = flags.combatVfx ? createCombatVfx({ scene, camera: camera.camera, isGore: () => flags.gore && isAgeAcknowledged() && isGoreEnabled() }) : null;
  // Vehicle damage (flag vehicleDamage): smoke / fire / wreck on damaged cars + explosions (fireball, flash, boom, shake).
  const vehicleFx = flags.vehicleDamage ? createVehicleFx({ scene }) : null;
  if (vehicleFx) explosionSink = (x, y, z) => {
    vehicleFx.explode(new THREE.Vector3(x, y, z));
    const d = Math.hypot(x - foot.x, z - foot.z);
    if (d < 250) playExplosion(Math.max(.08, 1 - d / 250));
    if (d < 40) { cameraShake = Math.max(cameraShake, .5 * (1 - d / 40)); cameraShakeUntil = performance.now() + 700; }
  };
  addEventListener('pagehide', () => vehicleFx?.dispose(), { once: true });
  if (flags.serverHits) renderRemoteShot = (from, to, hit, weapon) => {
    if (!isAgeAcknowledged()) return; // "Play without combat": no gunfire effects at all
    const spec = WEAPONS[WEAPON_ORDER[weapon] ?? 'pistol'];
    if (spec.melee) return; // a punch/swing has no tracer or crack
    combatVfx?.onShot({ from, to, weapon: spec, hit });
    // Nearby peds flee from it too. Gunfire only, never reportImpact: a ped downed by SOMEONE ELSE's shot must not
    // be confessed as this player's crime (COMBAT_CRIME).
    reportGunfire(from[0], from[2]);
    // Positional-ish crack: louder the closer the shooter (inaudible past ~120 m).
    const d = Math.hypot(from[0] - foot.x, from[2] - foot.z);
    if (d < 120) playGunshot({ volume: 0.4 * Math.max(0.15, 1 - d / 120), weapon: spec.id });
  };
  addEventListener('pagehide', () => combatVfx?.dispose(), { once: true });
  // ?combatvfxdemo: auto-fire synthetic shots forward from the player's chest so a headless capture shows the
  // muzzle flash / tracer / impact / blood without driving the full combat loop. Debug-only; no effect otherwise.
  const combatVfxDemo = Boolean(combatVfx) && typeof location !== 'undefined' && new URLSearchParams(location.search).has('combatvfxdemo');
  let combatVfxDemoAcc = 0; const combatVfxDemoDir = new THREE.Vector3();
  // weaponPoses (lane D): the equipped weapon in the local player's hands + an arm aim pose (avatar/heldWeapon.ts).
  const heldWeapon = flags.weaponPoses && flags.weapons && localAvatar ? createHeldWeapon(player) : undefined;
  let deathHold: { cam: THREE.Vector3; quat: THREE.Quaternion; body: THREE.Vector3; yaw: number } | null = null; // deathCamHold
  let lastShotAt = -Infinity, lastMeleeAt = -Infinity, aimWeight = 0, aimingUiShown = false; const aimLook = new THREE.Vector3();
  // Lane B (gtasf-2x1b2 follow-up): hold the right mouse button on the game canvas to raise and aim the gun (GTA-style),
  // not only for 1.5 s after a shot. RMB still drives the drag-look; this just keeps the aim pose + shoulder camera up.
  let aimHeld = false;
  if (heldWeapon) {
    addEventListener('pointerdown', e => { if (e.button === 2 && e.target instanceof HTMLCanvasElement) aimHeld = true; });
    addEventListener('pointerup', e => { if (e.button === 2) aimHeld = false; });
    addEventListener('blur', () => { aimHeld = false; });
  }
  const combat = createCombat({
    optionsPanel: gameOptions?.content,
    respawn() {
      const frame = world!.manifest.frame;
      const hospital = flags.nearestHospitalRespawn ? nearestHospital(foot, (lat, lon) => projectLocation(lat, lon, frame)) : SF_GENERAL_RESPAWN;
      if ('name' in hospital) pendingWake = hospital.name;
      const p = projectLocation(hospital.lat, hospital.lon, frame);
      const road = world!.nearestRoad(p.x, p.z, 200);
      const x = road?.x ?? p.x, z = road?.z ?? p.z;
      foot.x = x; foot.z = z;
      foot.y = road?.y ?? world!.heightAt(x, z) ?? foot.y;
      foot.yaw = road?.yaw ?? foot.yaw;
      if (flags.nearestHospitalRespawn) faceHospitalArrival(hospital.heading); // each hospital's wake view
      else if (flags.sfGeneralArrival) faceSfGeneralArrival();
    },
    hasModal: () => hasModal(),
    isOnFoot: () => mode === 'on-foot',
    inVehicle: () => mode === 'driver' || mode === 'passenger',
    getStage: () => currentRound?.stars ?? 0,
    getCurrentCents: () => { const c = latestFundingCents; try { return c === undefined ? null : BigInt(c); } catch { return null; } },
    getSid: () => selfId || undefined,
    onNotify: text => notify(text, 4000),
    onDismissNotice: text => { toasts.dismissNotice(text); if (statusLine.textContent === text) noticeUntil = 0; }, // critic N15
    onEvent: (step, source) => combatStep(step, source),
    onValuation: () => { void funding?.refreshProfile(); }, // a combat debit/credit settled: refresh the HUD $
    onServerFire: (weapon, dir) => { net?.send({ type: 'COMBAT_FIRE', weapon: WEAPON_ORDER.indexOf(weapon), dir }); },
    // Combat opt-in (18+ accepted): tell the server this player may be a PvP target. [gtasf-funnel-gate]
    onCombatStart: () => { net?.send({ type: 'COMBAT_READY' }); if (flags.sampledAudio) preloadSamples(['pistol', 'smg', 'rifle', 'punch', 'crash', 'sirens-distant', 'siren-wail', 'siren-yelp', 'engine', 'bark-hold', 'bark-getdown', 'bark-lookout', 'bark-backup', 'scream-f1', 'scream-f2', 'scream-m1', 'scream-m2', ...(flags.hurtGrunts ? HURT_VOICES : [])]); },
    fire: {
      aimLook: (dx: number, dy: number) => { if (!hasModal()) { camera.look(dx, dy); movementYaw = camera.yaw; } }, // twinStick: the FIRE stick aims
      scene, camera: camera.camera, canvas,
      // Tracer starts at the player's chest (placeholder; lane A owns real muzzle/tracer visuals via onShot).
      muzzleOrigin: out => {
        // driveBy: from a car, the shot leaves the car (driver: the driven pose; passenger: the ride), not the stale foot.
        const ride = flags.driveBy && mode === 'passenger' ? fleet.cars.get(vehicleId)?.model.root.position : undefined;
        if (flags.driveBy && mode === 'driver' && driving) return out.set(driving.x, driving.y + 1.3, driving.z);
        if (ride) return out.set(ride.x, ride.y + 1.6, ride.z);
        return out.set(foot.x, foot.y + 1.4, foot.z);
      },
      onShot: shot => { combatVfx?.onShot(shot); shotFeel?.fired(shot.weapon, performance.now()); lastShotAt = performance.now(); if (shot.weapon.melee) lastMeleeAt = lastShotAt; },
      ignoreRoot: () => (flags.driveBy && mode !== 'on-foot' ? fleet.cars.get(vehicleId)?.model.root : undefined),
      selfRoot: () => player,
      // aimControls: aim-assist candidates at chest height (street peds, SFPD on foot, other players on foot).
      aimTargets: out => {
        for (const w of streetWalkers?.positions() ?? []) out.push({ x: w.x, y: w.y + 1.2, z: w.z, kind: 'ped' });
        for (const o of policeOfficers?.positions() ?? []) out.push({ x: o.x, y: o.y + 1.4, z: o.z, kind: 'cop' });
        for (const a of remoteAvatars.values()) if (a.root.parent === scene && a.root.visible) out.push({ x: a.root.position.x, y: a.root.position.y + 1.4, z: a.root.position.z, kind: 'player' });
      },
      aimAt: (x, y, z) => { if (!hasModal()) { camera.aimToward(x, y, z); movementYaw = camera.yaw; } },
    },
  });
  // Street-crime wanted (flag streetCrimeWanted): confess peds this player wastes (shot or run over) so the SERVER
  // raises their wanted level — peds are client-only, so the server can't see those kills. [gtasf-laneb-combat-epic-igho.3]
  if (flags.combat && flags.wanted && flags.streetCrimeWanted) onPedWasted(kind => { net?.send({ type: 'COMBAT_CRIME', kind }); });
  // Melee takedowns (flag pedMelee): a ped who fought back landed a swing; the server applies the damage.
  if (flags.combat && flags.pedMelee) onPedPunch(() => { if (combat?.started && mode === 'on-foot') net?.send({ type: 'PED_PUNCH' }); });
  addEventListener('pagehide', () => combat?.destroy(), { once: true });
  combatStartedNow = () => combat?.started === true;
  if (flags.policePresence && combat) policeBarks = createPoliceBarks(document.body);
  if (flags.shootingFeel && combat) shotFeel = createShotFeel({ parent: document.body, crosshair: () => document.querySelector<HTMLElement>('.gt-combat-crosshair') });
  // Health + armour pickups (flag vitalsPickups): drawn here, owned by the server.
  const vitalPickups = flags.vitalsPickups && combat ? createVitalPickups({ scene, surfaceHeightAt: (x, z) => surface.heightAt(x, z) ?? world!.surfaceHeightAt(x, z) ?? 0,
    project: (lat, lon) => projectLocation(lat, lon, world!.manifest.frame) }) : null;
  if (vitalPickups) { pickupSink = (i, a) => vitalPickups.setAvailable(i, a); for (const [i, a] of pickupBacklog) vitalPickups.setAvailable(i, a); }
  vitalsSink = (h, a) => combat?.setVitals(h, a);
  addEventListener('pagehide', () => vitalPickups?.dispose(), { once: true });
  // GTA V pivot — LANE B: flashing SFPD light bar over POLICE_FLAG pursuit cars (set server-side by WorldPolice).
  // Decoupled from the car renderer (lane A) — reads fleet.cars by flag. Byte-inert until combat+wanted enable.
  const policeLights = flags.combat && flags.wanted ? createPoliceLights(scene) : null;
  addEventListener('pagehide', () => policeLights?.dispose(), { once: true });
  // SFPD siren (death-polish layer): rises as the nearest pursuit car closes in. Needs the police to exist
  // (combat+wanted) plus the ragdollAudio polish flag. Byte-inert otherwise. [gtasf-combat-ragdoll-audio-peds]
  const siren = flags.combat && flags.wanted && flags.ragdollAudio ? createSiren() : null;
  addEventListener('pagehide', () => siren?.dispose(), { once: true });
  // Free weapon pickups at fixed SF spots (GTA-style): walk into one to grab that weapon. Needs the combat
  // runtime + the gunShop flag; byte-inert otherwise. The paid gun shop (weapon wheel) still works. [gtasf-combat-gunshop]
  const WEAPON_PICKUP_SPOTS = [
    { weapon: 'bat', lat: 37.795799, lon: -122.394805 }, // just off the Ferry plaza (walkable-verified)
    { weapon: 'smg', lat: 37.800877, lon: -122.405615 }, // along the Embarcadero/Columbus corridor (walkable-verified)
    { weapon: 'rifle', lat: 37.802286, lon: -122.417279 }, // up near the Lombard hills (walkable-verified, snap 0m)
  ] as const;
  const weaponPickups = combat && flags.gunShop ? (() => {
    const spots = WEAPON_PICKUP_SPOTS.map(s => { const p = projectLocation(s.lat, s.lon, world!.manifest.frame); return { weapon: s.weapon as WeaponId, x: p.x, z: p.z }; });
    // Walking into a pickup is a combat action: if the player hasn't confirmed 18+ yet, this opens the gate
    // (deferred from load for the funnel) and hands them the weapon once they accept. [gtasf-funnel-gate]
    return createWeaponPickups({ scene, surfaceHeightAt: (x, z) => surface.heightAt(x, z) ?? world!.surfaceHeightAt(x, z) ?? 0, spots, giveWeapon: id => combat.requestCombat(() => { combat.giveWeapon(id); combatStep('weapon_pickup', id); }), onNotify: text => notify(text, 3500) });
  })() : null;
  addEventListener('pagehide', () => weaponPickups?.dispose(), { once: true });
  // Carjack pull-out cosmetic: eject a ragdolling driver beside a moving traffic car when you jack it. Needs the
  // combat runtime + carjacking flag + a loaded avatar template; byte-inert otherwise. [gtasf-combat-carjacking]
  const carjackEffect = combat && flags.carjacking && avatarTemplate ? createCarjackEffect({ scene, template: avatarTemplate }) : null;
  addEventListener('pagehide', () => carjackEffect?.dispose(), { once: true });
  // SFPD officers on foot (flag sfpdOnFoot): lane A's officer avatars for the server's 'foot' pursuit units.
  const policeOfficers = flags.sfpdOnFoot && combat && avatarTemplate ? createPoliceOfficers({ scene, template: avatarTemplate,
    surfaceHeightAt: (x, z) => surface.heightAt(x, z) ?? world!.surfaceHeightAt(x, z) ?? 0, armed: flags.policePresence }) : null; // critique #16: drawn pistols
  if (policeOfficers) officerSink = entries => policeOfficers.sync(entries);
  addEventListener('pagehide', () => policeOfficers?.dispose(), { once: true });
  // Persistent NPC drivers in the nearest traffic cars (Combat 6b) — decoupled overlay, no fleet.ts edit. Byte-inert
  // until the trafficDrivers flag enables (after lane-A's look pass + ferry phone-perf gate). [gtasf-ieoj]
  const trafficDrivers = flags.trafficDrivers && avatarTemplate ? createTrafficDrivers({ template: avatarTemplate }) : null;
  addEventListener('pagehide', () => trafficDrivers?.dispose(), { once: true });
  if (trafficDrivers && flags.carEnterAnim) ejectTrafficDriver = carId => { // gtasf-9jl2j: out the driver's door, running away from the car
    const car = fleet.cars.get(carId); if (!car) return;
    // Push out along the DOOR NORMAL (seat -> exit node: the same forward offset, so purely sideways) and start clear of
    // the body: 'door - root' pointed rearward on models whose origin isn't mid-car, so the stumble passed under the bumper
    // (critic nit, 10-18 23:15).
    const door = car.model.exit.getWorldPosition(new THREE.Vector3()), seatAt = car.model.seat.getWorldPosition(new THREE.Vector3());
    const dx = door.x - seatAt.x, dz = door.z - seatAt.z, l = Math.hypot(dx, dz) || 1;
    door.x += dx / l * .4; door.z += dz / l * .4;
    trafficDrivers.eject(carId, scene, door, { x: dx / l, z: dz / l }, (x, z) => world.surfaceHeightAt(x, z));
  };
  // Store robberies: a "💰 Rob" marker per SF store; linger in the zone to rob it. The server validates the pose,
  // pays the valuation credit + raises a 2-star wanted; here we just POST + reflect the result. [gtasf-combat-store-robberies]
  const storeRobberies = combat && flags.storeRobberies ? createStoreRobberies({
    scene, surfaceHeightAt: (x, z) => surface.heightAt(x, z) ?? world!.surfaceHeightAt(x, z) ?? 0,
    spots: STORE_ROBBERIES.map(s => { const p = projectLocation(s.lat, s.lon, world!.manifest.frame); return { ...s, x: p.x, z: p.z }; }),
    // Two-phase, server-authoritative (review fix 2): rob-start records the hold; rob-complete pays after the
    // server re-checks the >=2.5s hold + the pose. Each returns the server status for the module's phase machine.
    robStart: async storeId => {
      // Starting a robbery is a combat action: if the player hasn't confirmed 18+, open the gate (deferred from
      // load) and don't start the hold. Return 'pending' (NOT 'off') so the marker stays retryable — 'off' would
      // latch the store's phase to 'done' and permanently disable it; 'pending' keeps it idle so the robbery works
      // the moment they accept the gate. [gtasf-funnel-gate]
      if (!combat.requestCombat()) return 'pending';
      // gtasf-j7wvv: not while the world socket is down (a reset/reconnect): the server answers 409 not-connected, a
      // console error that fails perf scenarios. 'pending' keeps the store idle and retried (backoff) once we're back.
      if (!connected) return 'pending';
      try {
        const res = await fetch('/api/funding/rob-start', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, sid: selfId }) });
        const data = await res.json().catch(() => ({})) as { status?: string };
        if (data.status === 'blocked') notify(`${STORE_ROBBERIES.find(s => s.id === storeId)?.name ?? 'The store'} was already hit today.`, 3500);
        return res.status === 404 ? 'off' : (data.status ?? 'error');
      } catch { return 'error'; }
    },
    robComplete: async storeId => {
      // gtasf-j7wvv: a completion that lands in a reconnect window must RETRY, not end the robbery unpaid: the module
      // finishes on anything but 'too-soon', while the server still holds the attempt across the drop (grace). A retry
      // after a payout that did land answers 'blocked' (the daily cooldown is D1-enforced), so it can't pay twice.
      if (!connected) return 'too-soon';
      try {
        const res = await fetch('/api/funding/rob-complete', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, sid: selfId }) });
        const data = await res.json().catch(() => ({})) as { status?: string; error?: string; outcome?: { amountCents?: string } };
        if (data.error === 'not-connected') return 'too-soon';
        const name = STORE_ROBBERIES.find(s => s.id === storeId)?.name ?? 'the store';
        if (data.status === 'robbed') { notify(`Robbed ${name} for $${Math.round(Number(data.outcome?.amountCents ?? '0') / 100).toLocaleString()}!`, 4500); combatStep('robbery', storeId); }
        else if (data.status === 'blocked') notify(`${name} was already hit today.`, 3500);
        return data.status ?? 'error';
      } catch { return 'error'; }
    },
  }) : null;
  addEventListener('pagehide', () => storeRobberies?.dispose(), { once: true });
  // Combat places on the radar (flag combatRadarBlips): robbable stores + free weapon pickups, so players can find
  // them. Hidden for anyone who chose "Play without combat" (re-checked every 2 s in the loop; the choice can change).
  const combatPlaces = (flags.combatRadarBlips || flags.wantedEscape) && combat ? [
    ...(flags.wantedEscape ? HIDEOUTS.map(s => ({ ...projectLocation(s.lat, s.lon, world!.manifest.frame), kind: 'hideout' as const })) : []), // gtasf-66lvh
    ...(flags.wantedEscape ? RESPRAY_SHOPS.map(s => ({ ...projectLocation(s.lat, s.lon, world!.manifest.frame), kind: 'respray' as const })) : []),
    ...(!flags.combatRadarBlips ? [] : flags.storeRobberies ? STORE_ROBBERIES.map(s => ({ ...projectLocation(s.lat, s.lon, world!.manifest.frame), kind: 'store' as const })) : []),
    ...(flags.combatRadarBlips && weaponPickups ? WEAPON_PICKUP_SPOTS.map(s => ({ ...projectLocation(s.lat, s.lon, world!.manifest.frame), kind: 'weapon' as const })) : []),
    ...(flags.combatRadarBlips && flags.nearestHospitalRespawn ? RESPAWN_HOSPITALS.map(h => ({ ...projectLocation(h.lat, h.lon, world!.manifest.frame), kind: 'hospital' as const })) : []),
  ].map(p => ({ x: p.x, z: p.z, kind: p.kind })) : [];
  let lastCombatPlacesSync = -Infinity;
  const onCityDestination = (destination: CityLifeDestination) => {
    const target = { ...destination, walkingStop: true };
    if (!radar?.setDestination(target)) return false;
    linkedDestination.cancel();
    selectedDestination = target; guidance?.setDestination(target); void funding?.selectEvent(null);
    gameOptions?.hide(); notify(`${target.title}. ${destination.description}`, 8000); return true;
  };
  performance.mark('gtasf:citylife-start');
  // Cold load: city life waits on a vehicle model; attach it when ready instead of holding READY. [gtasf-0k01]
  let cityLife: Awaited<ReturnType<typeof createCityLife>> = null, unmountCityLife: (() => void) | undefined;
  void createCityLife({ landmarks, parent: gameOptions.content, low: foundation.tier === 'low',
    onNotice: text => notify(text, 8000),
    onDestination: onCityDestination,
  }).then(result => {
    if (!result) return;
    if (appDisposed) { result.dispose(); return; }
    cityLife = result; unmountCityLife = foundation.mountGeometry(result.root);
  }).catch(error => { console.warn('City life could not load.', error); });
  let parkedVehicles: Awaited<ReturnType<typeof createParkedVehicles>> = null;
  let streetWalkers: Awaited<ReturnType<typeof createStreetWalkers>> = null;
  let appDisposed = false;
  const ferryPedestrians = createFerryPedestrians({ enabled: flags.pedestrians, template: avatarTemplate, landmarks,
    ground: surface, isLoaded: (x, z) => world.heightAt(x, z) !== null, low: foundation.tier === 'low' });
  const coffeeQueue = createCoffeeQueue({ enabled: flags.coffeeQueues, template: avatarTemplate, landmarks,
    ground: surface, isLoaded: (x, z) => world.heightAt(x, z) !== null, low: foundation.tier === 'low',
    parent: gameOptions.content, onDestination: onCityDestination, onNotice: text => notify(text, 8000) });
  const doloresWeekend = createDoloresWeekend({ enabled: flags.doloresWeekend, template: avatarTemplate,
    ground: surface, isLoaded: (x, z) => world.heightAt(x, z) !== null, low: foundation.tier === 'low',
    parent: gameOptions.content, now: () => net?.clock.serverNow() ?? Date.now(),
    onDestination: onCityDestination, onNotice: text => notify(text, 8000) });
  // Hidden parody angel-investor NPCs (PLAN-v2 decision 4). celebNpcs is dev-only until the founder
  // approves docs/content/celebs.md. Confirmed once-ever pitch records are cached locally, then
  // reconciled with the funding server below.
  const angelPitchedKey = 'gtasf:angels:pitched';
  const angelsPitched = (() => { try { return JSON.parse(localStorage.getItem(angelPitchedKey) ?? '[]') as string[]; } catch { return []; } })();
  const angels = createAngelInvestors({ enabled: flags.celebNpcs, template: avatarTemplate,
    ground: surface, isLoaded: (x, z) => world.heightAt(x, z) !== null,
    geoToWorld: (lat, lon) => projectLocation(lat, lon, world.manifest.frame),
    low: foundation.tier === 'low', pitched: angelsPitched });
  const angelPitch = angels ? createAngelPitch({ angels, funding,
    persist: ids => localStorage.setItem(angelPitchedKey, JSON.stringify(ids)),
    onReply: (result, firstTime) => notify(firstTime ? `${celebLabel(result.npc)}: ${result.line}` : 'You have already pitched this investor.'),
    onError: message => notify(message),
  }) : null;
  // Animated rigs own their materials; static-world material conversion would break their fades.
  if (ferryPedestrians) scene.add(ferryPedestrians.root);
  if (angels) scene.add(angels.root);
  if (coffeeQueue) scene.add(coffeeQueue.root);
  if (doloresWeekend) scene.add(doloresWeekend.root);
  const phoneHud = createPhoneHud({ parent: gameOptions.content, closeOptions: () => gameOptions?.hide(), enabled: flags.hud && flags.mobile, minimal: true });
  // PLAN-v2 §11: the "What's new" card. createWhatsNew is a no-op when flags.changelog is off
  // or there is no released entry; input is released and conflicting panels hidden while it is open.
  whatsNew = createWhatsNew({ onModalChange(open) {
    input?.release(); keyboard?.release();
    if (open) { radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs(); eventSubmit?.close(); feedback?.close(); }
  } });
  // The profile response installs the same device cookie that World attendance authenticates.
  performance.mark('gtasf:funding-start');
  const fundingProfile = await funding?.init();
  performance.mark('gtasf:funding-done');
  if (fundingProfile) void collectedEvents?.refresh();
  // Construct after profile hydration so returning players do not get a spurious unlock toast.
  wardrobe = createWardrobe({ getAppearance: () => localAppearance, getRound: () => currentRound ?? FUNDING_ROUNDS[0]!,
    choices: avatarLookChoices, onChange: changeAppearance,
    onUnlock: tier => {
      if (flags.garageSlots) void loadGarage(); // a tier-up can gift a car: announce it with the look
      if (!flags.lookUnlockReward) { toasts.show({ title: 'LOOK UNLOCKED', detail: tier.label, tone: 'info' }); return; }
      // lookUnlockReward (critic 20c / lane D): say what was unlocked, that it's already on, and where to see it.
      // Only what's true today (lane D, 10-19): the tier garment kit doesn't render on Meshy bodies (applyLook returns when
      // rig !== base), so no promise of a visible outfit — the nameplate and the Wardrobe's tier row change. The visible
      // tier dress is lane D's gtasf-4vgje. Phones show one-line toasts, so the title carries it.
      // With meshyTierDress the tier garment DOES render on the player's Meshy body (lane D, tierDress.ts), so name the look.
      const touch = matchMedia('(pointer: coarse)').matches, where = touch ? 'Wardrobe in the menu' : 'press O';
      const dressed = flags.meshyTierDress, outfit = tier.outfit.replaceAll('-', ' + ');
      const show = () => toasts.show(dressed
        ? { title: touch ? `NEW LOOK: ${tier.label} · ${outfit}` : 'NEW LOOK UNLOCKED', detail: `${tier.label}: ${outfit} — you're wearing it · ${where}`, tone: 'info' }
        : { title: `${tier.label.toUpperCase()} TIER REACHED`, detail: `Your nameplate and Wardrobe now show ${tier.label} · ${where}`, tone: 'info' });
      // critic 20f nit: take a turn in the centre slot (after the payout card and RANK UP) instead of printing over them.
      if (flags.centerSlotQueue) centerSlot.enqueue({ naturalMs: 3200, order: 3, show, hide: () => {} }); else show();
    },
    onModalChange(open) {
      input?.release(); keyboard?.release();
      if (open) {
        closeInspectionDialogs();
        radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); whatsNew?.close(); eventSubmit?.close(); feedback?.close(); becomeAnAngel?.close();
        releaseWardrobeCursor ??= holdFreeCursor();
        if (document.pointerLockElement) document.exitPointerLock();
      } else { releaseWardrobeCursor?.(); releaseWardrobeCursor = undefined; }
    },
  });
  if (wardrobe) gameOptions.content.append(wardrobe.launcher);
  // Seed the authoritative once-ever angel-pitch record so re-pitching a backed investor is a no-op.
  // Gated on celebNpcs: in production the feature (and its /api/funding/pitch* endpoints) is off, so
  // calling this unconditionally 503s there and seeds nothing (angels are disabled anyway).
  if (flags.celebNpcs) void funding?.pitchedCelebs().then(ids => angels?.setPitched(ids)).catch(() => { /* offline: localStorage seed stands */ });
  const worldNickname = normalizeNickname(fundingProfile?.nickname ?? 'Founder');
  const reconnectNotice = flags.reconnectNotice ? createReconnectNotice() : null; // gtasf-j7wvv: drops > 1 s say so
  const netBeacon = createNetBeacon(); // gtasf-j7wvv: consent-free drop-rate counts
  try { if (worldNickname) localStorage.setItem('gtasf.worldNickname', worldNickname); } catch { /* storage blocked */ } // earlyWorldSocket's next boot
  const worldHandlers = { message, dropped: (code: number, upMs: number) => netBeacon?.dropped(code, upMs), welcomed: () => netBeacon?.welcomed(), status(text: string) {
    connection.textContent = text; connected = text === 'Connected'; taxi.setConnected(connected); reconnectNotice?.set(connected);
    if (!connected) { proximityVoice?.disconnect(); voiceUi?.hide(); }
  } };
  net = !flags.multiplayer ? undefined : earlyWorld ? (earlyWorld.attach(worldHandlers), earlyWorld.socket)
    : connectWorld({ name: worldNickname ?? 'Founder', spawn: encodePose(foot), ...worldHandlers });
  void radar?.routingReady.then(() => linkedDestination.start());
  actions.on('enter-exit', enterExit); actions.on('hail', hail); actions.on('share', () => { void share(); });
  actions.on('ride', () => { if (mode === 'on-foot' && !hasModal() && currentRound) rideSystem?.toggle(currentRound); });
  // Playful Mayhem (flag): aim with the camera, Q fires the selected toy (render draws the splat/burst
  // via foundation.mayhem), X cycles it; non-lethal, gated to on-foot. Colour = a hash of your startup.
  const mayhemRay = new THREE.Raycaster(), mayhemAim = new THREE.Vector2(0, 0);
  // Paint only solid meshes: Lines/LineSegments2 (overhead wires) and Points throw or need raycaster.camera.
  mayhemRay.params.Line = { threshold: 0 }; mayhemRay.params.Points = { threshold: 0 };
  const paintable = (o: THREE.Object3D) => (o as THREE.Mesh).isMesh === true && !(o as { isLineSegments2?: boolean }).isLineSegments2 && o.visible;
  const paintTargets: THREE.Object3D[] = [];
  const paintHits = () => {
    mayhemRay.camera = camera.camera; paintTargets.length = 0;
    scene.traverseVisible(o => { if (paintable(o)) paintTargets.push(o); });
    try { return mayhemRay.intersectObjects(paintTargets, false); } catch { return []; }
  };
  const startupColour = (name: string) => {
    let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    let hue = h % 360; if (hue >= 25 && hue <= 75) hue += 160; // skip sandstone/gold hues so paint pops on facades
    return new THREE.Color().setHSL(hue / 360, 1, .55).getHex();
  };
  mayhem = flags.playfulMayhem ? createMayhemController({
    raycast: () => {
    const reticle = (): MayhemHit | null => {
      mayhemRay.setFromCamera(mayhemAim, camera.camera); mayhemRay.far = 55;
      for (const hit of paintHits()) {
        if (!hit.face || hit.distance < 1) continue; // need a surface; skip point-blank self
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        const r: MayhemHit = { at: [hit.point.x, hit.point.y, hit.point.z], normal: [n.x, n.y, n.z] };
        return r;
      }
      return null;
    };
    // Paint-first onboarding: the first shots auto-aim at the Ferry facade whatever the reticle is on.
    const paintIntro = Boolean(onboarding && !onboarding.state.completed && onboarding.state.step === 'intro');
    const aimed = paintIntro ? null : reticle();
    if (aimed) return aimed;
    if (!paintIntro) return null;
    if (request.place.organiser) {
      // At an organiser venue: paint whatever the crosshair is on, else a splash just ahead (never the far-off Ferry).
      const r = reticle(); if (r) return r;
      const fwd = new THREE.Vector3(); camera.camera.getWorldDirection(fwd);
      const p = camera.camera.position.clone().addScaledVector(fwd, 12);
      return { at: [p.x, p.y, p.z], normal: [-fwd.x, -fwd.y, -fwd.z] } satisfies MayhemHit;
    }
    const ferry = ferrySpawn(surface.heightAt), out = new THREE.Vector3(ferry.x - ferry.lookAt.x, 0, ferry.z - ferry.lookAt.z).normalize();
    const target = new THREE.Vector3(ferry.lookAt.x + out.x * 18, ferry.lookAt.y - 22, ferry.lookAt.z + out.z * 18);
    mayhemRay.set(camera.camera.position, target.clone().sub(camera.camera.position).normalize()); mayhemRay.far = 200;
    // The first shot must land ON the Ferry facade: skip cars, people and palms between camera and building.
    const ferryBuilding = landmarks.children.find(object => object.userData.landmarkId === 'ferry-building');
    const onFerry = (object: THREE.Object3D) => { for (let o: THREE.Object3D | null = object; o; o = o.parent) if (o === ferryBuilding) return true; return !ferryBuilding; };
    for (const hit of paintHits()) {
      if (!hit.face || hit.distance < 4 || !onFerry(hit.object)) continue;
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      return { at: [hit.point.x, hit.point.y, hit.point.z], normal: [n.x, n.y, n.z] } satisfies MayhemHit;
    }
    return { at: [target.x, target.y, target.z], normal: [out.x, 0, out.z] } satisfies MayhemHit;
    },
    colour: () => startupColour(funding?.profile?.startupName || 'Founder'),
    send: message => net?.send(message),
  }) : null;
  actions.on('mayhem-fire', () => { if (mayhem && mode === 'on-foot' && !hasModal()) { const e = mayhem.fire(performance.now()); if (e) {
    foundation.mayhem?.fire(e); if (e.item === 'paintball') playSplat();
    if (onboarding?.state.step === 'intro' && !onboarding.state.completed) { // first-shot celebration: a big splash + confetti
      const n = e.normal ?? [0, 0, 1], t = new THREE.Vector3(n[2], 0, -n[0]).normalize(); // along-facade tangent
      for (let i = 0; i < 14; i++) { const u = (Math.random() - .5) * 9, v = (Math.random() - .5) * 6;
        foundation.mayhem?.fire({ ...e, size: 2.5, at: [e.at[0] + t.x * u * 1.6, e.at[1] + v * 1.4, e.at[2] + t.z * u * 1.6] }); }
      foundation.mayhem?.fire({ item: 'confetti', at: [foot.x, foot.y + 3, foot.z], colour: e.colour ?? MAYHEM_DEFAULT_COLOUR.confetti });
      onboarding.stepCleared('intro');
    }
  } } });
  // Keyboard Q/X are handled here on window keydown (capture), not via the polled input map: they must
  // work straight after load, with or without a canvas click / pointer lock / the look-fallback hint.
  addEventListener('keydown', event => {
    if (!mayhem || event.repeat || event.ctrlKey || event.metaKey || event.altKey || consumesTextKeys(event.target)) return;
    if (event.code === 'KeyQ') { event.preventDefault(); actions.emit('mayhem-fire', undefined); }
    else if (event.code === 'KeyX') { event.preventDefault(); actions.emit('mayhem-cycle', undefined); }
  }, true);
  // Event detail card opener (gtasf-event-card-unreachable-2kvx): the marker toast + keyboard footer
  // advertise an "events" key, but hud.showEvent had no caller. V opens the detail card for the event
  // you're at (or toggles the upcoming list otherwise) and closes whichever is open; J when proximityVoice
  // has taken V for push-to-talk.
  const eventDetailCode = flags.proximityVoice ? 'KeyJ' : 'KeyV';
  addEventListener('keydown', event => {
    if (event.code !== eventDetailCode || event.repeat || event.ctrlKey || event.metaKey || event.altKey || consumesTextKeys(event.target)) return;
    if (eventOpen) { event.preventDefault(); hud?.hideEvent(); return; }
    if (upcomingOpen) { event.preventDefault(); upcoming?.toggle(false); return; }
    if (hasModal()) return;
    event.preventDefault();
    if (nearbyEvent && hud) hud.showEvent(nearbyEvent); else upcoming?.toggle();
  }, true);
  // LANE C in-game phone (jobs list): N toggles it. The phone only mounts behind `missions`, so this is inert
  // in prod with the flag off. Don't open it over another modal; closing is always allowed.
  addEventListener('keydown', event => {
    if (event.code !== 'KeyN' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || consumesTextKeys(event.target)) return;
    if (!missionPhone) return;
    if (!missionPhone.isOpen && hasModal()) return;
    event.preventDefault();
    missionPhone.toggle();
  }, true);
  actions.on('mayhem-cycle', () => { if (mayhem && mode === 'on-foot' && !hasModal()) mayhem.cycle(1); });
  actions.on('outfit', () => {
    if (wardrobe?.isOpen) wardrobe.hide();
    else if (!hasModal()) { if (wardrobe) wardrobe.show(); else nextOutfit(); }
  });
  // R is also the weapon reload (weaponWheel binds KeyR once combat is live): on foot that press must ONLY reload — it
  // used to also snap the player to the nearest road (a jump of up to ~80 m). In a vehicle R still recovers a stuck car;
  // the game-options 'Recover to road' button is unaffected.
  actions.on('recover', guardedRecoverRoad);
  // Natural chat (PLAN-v2.1 §6): the chat key now opens the inline input in the always-visible log
  // (no modal). While it's focused the input system blocks movement keys; Esc closes. The full
  // channel/history modal stays reachable from its Game-options button.
  actions.on('chat', () => { if (!hasModal()) chat?.openInline(); });
  actions.on('horn', () => { if (!hasModal() && mode !== 'on-foot') vehicleAudio?.horn(vehicleId); });
  document.querySelector('#enter-exit')!.addEventListener('click', enterExit);
  const hailButton = document.querySelector<HTMLButtonElement>('#hail')!;
  hailButton.addEventListener('click', hail);
  // Tappable ride control (mobile reachability for personal rides); emits the same 'ride' action as KeyG.
  const rideButton = document.querySelector<HTMLButtonElement>('#ride');
  rideButton?.addEventListener('click', () => {
    gameOptions?.hide(); // On phones this control lives inside Game options; close before the modal guard.
    actions.emit('ride', undefined);
  });
  // Tappable mayhem controls (mobile reachability); emit the same 'mayhem-fire'/'mayhem-cycle' as Q/X.
  const mayhemFireButton = document.querySelector<HTMLButtonElement>('#mayhem-fire');
  const mayhemItemButton = document.querySelector<HTMLButtonElement>('#mayhem-item');
  if (mayhemFireButton && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0)) {
    // Phones: a big always-visible 🎨 thumb button (not buried in Game options) — paint is the first thing to do.
    mayhemFireButton.textContent = '🎨'; mayhemFireButton.setAttribute('aria-label', 'Paintball · fire');
    mayhemFireButton.classList.add('gt-mayhem-float'); document.body.append(mayhemFireButton);
    // Paint step: pulse the 🎨 button until the first shot clears onboarding 'intro' (74 of 83 in-game phone
    // players stalled there overnight). Polled: onboarding is set up later in boot.
    // Same gate as setupOnboarding: with onboarding off there is no paint step, so never poll (a timer cutoff
    // could expire during a long phone cold load before onboarding exists).
    const attention = flags.onboarding && flags.hud ? window.setInterval(() => {
      const on = Boolean(onboarding && !onboarding.state.completed && onboarding.state.step === 'intro' && !mayhemFireButton.hidden);
      mayhemFireButton.classList.toggle('gt-mayhem-attention', on);
      if (onboarding && (onboarding.state.completed || onboarding.state.step !== 'intro')) window.clearInterval(attention);
    }, 500) : undefined;
  }
  // Paint-step assist (gtasf-paint-funnel): since #5.31 still ~76% of in-world new players stop at 'Paint the Ferry
  // Building' and most leave within a minute, while those who paint do it in ~17 s (median). If the step is still
  // open after 20 s on foot, the game fires the first paintball FOR them (auto-aim hits the Ferry from the spawn),
  // so the splat both teaches the button and clears the step normally. One retry at 35 s; never more.
  if (flags.playfulMayhem && flags.onboarding) {
    let introSince = 0, assists = 0;
    const assist = window.setInterval(() => {
      if (!onboarding) return;
      if (onboarding.state.completed || onboarding.state.step !== 'intro' || assists >= 2) { window.clearInterval(assist); return; }
      if (mode !== 'on-foot' || hasModal() || document.querySelector('dialog[open]')) { introSince = 0; return; }
      const now = performance.now(); introSince ||= now;
      if (now - introSince < (assists ? 35_000 : 20_000)) return;
      assists++; introSince = now;
      trackAnalytics('paint_assist', { stage: assists === 1 ? 'first' : 'retry', is_mobile: isMobileDevice() }); // same device class as landing_view/load_ready
      toasts.notice(matchMedia('(pointer: coarse)').matches ? '🎨 Like this! Tap 🎨 to paint again.' : '🎨 Like this! Press Q to paint again.', 3500);
      actions.emit('mayhem-fire', undefined);
    }, 500);
  }
  // Long-press 🎨 (phones) swaps paint/confetti/water, like X; a normal tap fires.
  let mayhemHold = 0, mayhemHeld = false;
  mayhemFireButton?.addEventListener('pointerdown', () => { mayhemHeld = false; clearTimeout(mayhemHold);
    mayhemHold = window.setTimeout(() => { mayhemHeld = true; actions.emit('mayhem-cycle', undefined);
      const item = MAYHEM_ITEMS.find(i => i.id === mayhem?.selected)?.label; if (item && mayhemFireButton) mayhemFireButton.title = item;
      const p = document.querySelector('#prompt'); if (p) p.textContent = `${item ?? 'Item'} selected · tap 🎨 to fire`; }, 450); });
  for (const end of ['pointerup', 'pointercancel', 'pointerleave'] as const) mayhemFireButton?.addEventListener(end, () => clearTimeout(mayhemHold));
  mayhemFireButton?.addEventListener('contextmenu', e => e.preventDefault());
  mayhemFireButton?.addEventListener('click', () => { if (mayhemHeld) { mayhemHeld = false; return; } gameOptions?.hide(); actions.emit('mayhem-fire', undefined); });
  mayhemItemButton?.addEventListener('click', () => { gameOptions?.hide(); actions.emit('mayhem-cycle', undefined); });
  document.querySelector('#share-location')!.addEventListener('click', () => { void share(); });
  actions.on('map', () => radar?.toggleMap());
  actions.on('close', () => { radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs(); eventSubmit?.close(); feedback?.close(); });
  document.querySelector('#map-toggle')!.addEventListener('click', () => actions.emit('map', undefined));
  document.querySelector('#destination-lombard')!.addEventListener('click', () => {
    if (radar && !radar.setDestination(lombard)) return;
    linkedDestination.cancel(); selectedDestination = lombard; guidance?.setDestination(lombard); void funding?.selectEvent(null);
    notify('Destination: top of Lombard. Follow the yellow route or press H to hail.');
  });
  document.querySelector('#destination-ferry')!.addEventListener('click', () => {
    if (radar && !radar.setDestination(ferry)) return;
    linkedDestination.cancel(); selectedDestination = ferry; guidance?.setDestination(ferry); void funding?.selectEvent(null);
    notify('Destination: Ferry Building. Follow the yellow route or press H to hail.');
  });
  function resize() { foundation.resize(innerWidth, innerHeight); camera.resize(innerWidth, innerHeight); followFov = camera.camera.fov; }
  resize(); addEventListener('resize', resize);
  // Reveal the target's prebaked meshes while the loading card still covers the scene.
  loadStage(80, 'Parking the robotaxis…');
  for (let i = 0; i < 12; i++) { world.update(foot); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }
  loadStage(94, 'Finding other founders…');
  // Organiser link gtasf.com/e/<id> (flag organiserLinks): "<Event> is on the map" + one-tap Share on X. Shown as soon
  // as the world is built (not after the network join/onboarding awaits) and kept until the player dismisses it.
  const organiserPlace = request.place.organiser && request.place.eventId ? request.place : undefined;
  if (flags.organiserLinks && organiserPlace) {
    const { organiser, eventId, title } = organiserPlace;
    showOrganiserCard({ id: eventId!, title, venue: organiser!.venue, start: organiser!.start });
  }
  performance.mark('gtasf:world-ready'); // cold-load trace (tools/perf/phone-cold-load.mjs): world built, before the network join
  // sceneCompileEarly (gtasf-ep30n split, 10-20): the first tick spent ~0.5 s of a cold 4x phone blocked on shader program
  // links (onFirstUse 526 ms) after ~2.5 s of main-thread setup. Start an async compile of everything built so far now, so the
  // driver links programs (KHR_parallel_shader_compile) while setup runs, and wait for it (capped) just before the loop.
  const sceneCompile = flags.sceneCompileEarly ? renderer.compileAsync(scene, new THREE.PerspectiveCamera(), scene).catch(() => {}) : null;
  if (net) await waitForCityConnection(ready, loadingDetail);
  if (relocation) await relocation;
  performance.mark('gtasf:city-connected'); // cold-load trace: world-ready -> here = the network join wait
  // The pause menu (created after setupOnboarding resolves) moves the static desktop controls into its dialog; until
  // then they flashed unstyled over the first frames (gtasf-mi3b). Hidden via CSS until gt-hud-minimal is set.
  // Safety (1.0 review of c4e794c7): if setupOnboarding etc. throws before the pause menu exists, never leave the
  // controls hidden for the whole session; they reappear (unstyled, as before) after 10 s.
  if (flags.hud) { document.body.classList.add('gt-hud-pending'); window.setTimeout(() => document.body.classList.remove('gt-hud-pending'), 10_000); }
  // cardOnFirstTick (critic N13i-a): hide the loading card after the first animation-loop frame instead of here, so the
  // first-frame shader compile happens behind the card and the first game frame a visitor sees is one they can move in
  // (was ~1-2.6 s of a drawn-but-frozen world on a 4x phone). The beacon/analytics READY moves with the card.
  // QA read-only (?qaPrograms, gtasf-ep30n): which shader programs exist before the first tick, so a probe can list the ones the
  // first tick compiles (its ~0.5 s of link waits on a cold 4x phone) and warm them where their subsystem mounts. Declared here,
  // above hideLoadingCard: without cardOnFirstTick the card hides right below, before the loop is set up.
  const qaPrograms = new URLSearchParams(location.search).has('qaPrograms');
  // An unnamed program is labelled by a mesh that draws with it: material type + the nearest named ancestors (its subsystem).
  const programNames = () => {
    const owner = new Map<unknown, string>();
    if (qaPrograms) scene.traverse(o => {
      const mats = (o as { material?: THREE.Material | THREE.Material[] }).material; if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        const prog = (renderer.properties.get(m) as { currentProgram?: unknown }).currentProgram; if (!prog || owner.has(prog)) continue;
        const path: string[] = []; for (let a: THREE.Object3D | null = o; a && path.length < 3; a = a.parent) if (a.name) path.push(a.name);
        owner.set(prog, `${m.type}${m.name ? ':' + m.name : ''} @ ${path.join(' < ') || '(no names)'}`);
      }
    });
    return (renderer.info.programs ?? []).map(p => owner.get(p) ?? ((p as { name?: string }).name || '?')); // the owner label carries the material name too
  };
  let cardHidden = false;
  const hideLoadingCard = () => {
    if (cardHidden) return; cardHidden = true; markFirstFrame?.();
    if (qaPrograms) { const w = window as unknown as { __gtasfPrograms?: { before: string[]; after?: string[] } }; if (w.__gtasfPrograms) w.__gtasfPrograms.after = programNames(); }
    performance.mark('gtasf:card-hidden'); // cold-load trace: loop-setup-done -> here = the first tick (programs compile)
    loading.hidden = true; canvas.style.visibility = 'visible'; loadingBeacon?.ready();
    // PostHog funnel by device (gtasf-1k82): READY with the same elapsed buckets as the loading beacon.
    const ms = performance.now(), b = [[3e3, '0-3s'], [6e3, '3-6s'], [1e4, '6-10s'], [2e4, '10-20s'], [4e4, '20-40s'], [9e4, '40-90s']] as const;
    trackAnalytics('load_ready', { is_mobile: isMobileDevice(), stage: b.find(([limit]) => ms < limit)?.[1] ?? '90s+' });
  };
  if (flags.cardOnFirstTick) window.setTimeout(hideLoadingCard, 15_000); // never strand a visitor behind the card if setup throws
  else hideLoadingCard();
  if (!world.graphComplete) setTimeout(() => markGraphReady(), 0); // READY painted: stream the full city graph [gtasf-0k01]
  // PLAN-v2 §10: K-key feedback (F is the shoot key since the founder playtest). The module self-registers the `feedback` action (KeyK), grabs a
  // screenshot via requestCapture plus the player's location/state, and POSTs to /api/feedback.
  function requestCapture(): Promise<string | null> {
    return new Promise(resolve => {
      if (pendingCapture) { resolve(null); return; }
      pendingCapture = resolve;
      setTimeout(() => { if (pendingCapture === resolve) { pendingCapture = null; resolve(null); } }, 1500);
    });
  }
  feedback = createFeedback({
    parent: gameOptions.content, actions, capture: requestCapture,
    state: () => {
      const here = unprojectLocation(foot.x, foot.z, world!.manifest.frame);
      return { mode, startup: fundingProfile?.startupName ?? null, nick: worldNickname,
        worldX: foot.x, worldZ: foot.z, lat: here.lat, lon: here.lon,
        locationName: world!.locationNameAt(foot.x, foot.z).neighbourhood ?? null };
    },
    onModalChange(open) {
      input?.release(); keyboard?.release();
      if (open) { radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs(); whatsNew?.close(); eventSubmit?.close(); }
    },
  });
  // PLAN-v2 §5/§6: a read-only cap table opened by clicking any overhead nameplate.
  // Known leaderboard IDs take precedence; other nicknames resolve on the server.
  capTable = createCapTable({ parent: gameOptions.content, onModalChange(open) {
    input?.release(); keyboard?.release();
    if (open) { radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs('cap'); whatsNew?.close(); eventSubmit?.close(); feedback?.close(); releaseCapTableCursor ??= holdFreeCursor(); if (document.pointerLockElement) document.exitPointerLock(); }
    else { releaseCapTableCursor?.(); releaseCapTableCursor = undefined; }
  } });
  function openPlayerCapTable(id: number) {
    if (id === selfId) { capTable?.open(); return; } // click your own plate → your own cap table
    const nick = peerNames.get(id);
    const leader = nick ? latestLeaders.find(value => value.nickname === nick) : undefined;
    if (leader) capTable?.open({ deviceId: leader.deviceId, startup: leader.startupName, nick: leader.nickname });
    else if (nick?.trim()) capTable?.open({ nick });
  }
  nameplates = createNameplates({ onSelect: id => {
    if (voiceUi && id !== selfId) voiceUi.open(id, peerNames.get(id) ?? 'Founder');
    else openPlayerCapTable(id);
  }, fetchSummaries: nicks => funding?.summaries(nicks) ?? Promise.resolve([]) });
  if (proximityVoice) voiceUi = createVoiceUi({ parent: gameOptions.content, voice: proximityVoice,
    openCapTable: openPlayerCapTable,
    onModalChange(open) {
      input?.release(); keyboard?.release();
      if (open) {
        radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide();
        gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); capTable?.close(); adSlotPage?.close(); friendsPanel?.close();
        whatsNew?.close(); eventSubmit?.close(); feedback?.close(); becomeAnAngel?.close(); pauseMenu?.hide(); taxiPicker?.hide();
      }
    },
    async report(id, signal) {
      const sessionId = proximityVoice?.reportSession(id);
      if (!sessionId) throw new Error('No recent voice from this player to report. They are still muted.');
      const response = await fetch('/api/feedback', { method: 'POST', credentials: 'same-origin', signal,
        headers: { 'Content-Type': 'application/json', [VOICE_GATE_HEADER]: '1' }, body: JSON.stringify({ kind: 'voice', sessionId }) });
      const result = await response.json() as { ok?: boolean; kind?: string };
      if (!response.ok || result.ok !== true || result.kind !== 'voice') throw new Error('Voice report unavailable. The player is still muted; try again.');
    },
  });
  // Clickable "Buy this billboard" badges (founder feedback, gtasf-buy-ad-slot-page-yxua). The gated
  // slot page shows the slot id/price; checkout stays off (pane 7) until the founder enables it.
  adSlotPage = createAdSlotPage({ onModalChange(open) {
    input?.release(); keyboard?.release();
    if (open) { radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs('ad'); whatsNew?.close(); eventSubmit?.close(); feedback?.close(); becomeAnAngel?.close(); releaseAdSlotCursor ??= holdFreeCursor(); if (document.pointerLockElement) document.exitPointerLock(); }
    else { releaseAdSlotCursor?.(); releaseAdSlotCursor = undefined; }
  } });
  adSlotMarkers = createAdSlotMarkers({ onSelect: id => adSlotPage?.open({ kind: 'billboard', id }) });
  // "Become an angel" self-sponsor panel (gtasf-wkh7: dark feature -> reachable; become-an-angel.md).
  // Flag-gated (OFF in prod via PAYMENT_FLAGS). A real charge needs checkoutConfigured() + pane 7's
  // checkout, so the panel is reachable but inert until then. Opens from a Game-options button.
  becomeAnAngel = createBecomeAnAngel({ onModalChange(open) {
    input?.release(); keyboard?.release();
    if (open) { radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs(); whatsNew?.close(); eventSubmit?.close(); feedback?.close(); }
  } });
  if (becomeAnAngel) {
    const angelBtn = document.createElement('button'); angelBtn.type = 'button';
    angelBtn.className = 'gt-angel-launch'; angelBtn.textContent = 'Become an angel';
    angelBtn.addEventListener('click', () => becomeAnAngel?.open());
    gameOptions.content.append(angelBtn);
  }
  // Onboarding (gtasf-n34i): flag-off until the fresh-profile smoke passes. integrate.ts drives the SA
  // tutorial; main.ts wires the identity step to the SA identity screen (gtasf-8gbk), panel visibility
  // (stubbed — panels lack a uniform setVisible), loop signals (in update) + a Replay button.
  identityScreen = flags.onboarding ? createIdentityScreen({
    // Persist the startup name + handle, claim the global username (pane 13, best-effort — the server
    // also validates on save), then persist and apply the cosmetic identity without replacing wardrobe choices.
    onSave: async c => {
      await funding?.saveIdentity(c.startupName, c.username); // rejects -> surfaced by the screen's status line
      changeAppearance({ ...localAppearance, sex: c.sex, archetype: c.archetype });
      if (flags.friends) {
        try { await createFriendsClient().claim(c.username); } catch { /* offline: funding identity is still saved */ }
      }
    },
    onComplete: () => {
      const afterOrientation = onboarding?.state.step === 'identity';
      onboarding?.stepCleared('identity');
      if (afterOrientation) offerStartupRecovery(0);
    },
    onModalChange(open) { input?.release(); keyboard?.release(); if (open) { wardrobe?.hide(); closeInspectionDialogs(); if (document.pointerLockElement) document.exitPointerLock(); } },
  }) : null;
  // Founder ladder A/B (gtasf-founder-ladder-p1-ilnl): for a NEW device in the `ladder` bucket (flag on),
  // the founder-ladder spine owns the first run (found your startup → billboard → share); everyone else
  // keeps the current onboarding below. Inert when founderLadder is off (mountFounderLadder returns inactive).
  // One POST for both founder-ladder pitches (Pre-seed plaza + Seed office); vcId picks the target.
  const postFounderPitch = async (lineIndex: number, vcId?: string, memeNpcId?: string) => {
    founderPitchGraceUntil = Date.now() + 9000; // suppress the big toast around this scripted-card cheque
    try {
      const response = await fetch('/api/funding/pitch-text', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(memeNpcId ? { lineIndex, memeNpcId } : vcId ? { lineIndex, vcId } : { lineIndex }) });
      if (!response.ok) return null;
      const data = await response.json() as { pitch?: { status?: string; reason?: string; score?: number; verdict?: string; amountCents?: string; credited?: boolean; judge?: 'ai' | 'fallback' }; profile?: FundingProfile };
      if (data.profile) fundingHud?.setProfile(data.profile);
      const p = data.pitch;
      if (p?.status === 'blocked' && p.reason === 'cooldown') return 'cooldown' as const;
      return p?.status === 'judged' && typeof p.score === 'number' && typeof p.verdict === 'string' && typeof p.amountCents === 'string'
        ? { score: p.score, verdict: p.verdict, amountCents: p.amountCents, credited: Boolean(p.credited), judge: (p.judge === 'ai' ? 'ai' : 'fallback') as 'ai' | 'fallback' } : null;
    } catch { return null; }
  };
  // Phase-5 meme pitch: open (lazily create) the tap pitch card for a meme NPC. The archetype is FICTIONAL,
  // so the card bylines it directly ("A Patagonia-vest VC"), never "a partner at <firm>". The cheque +
  // per-day cooldown are server-authoritative (handlePitchTap memeNpcId branch); the id goes to the server.
  function openMemePitch(spec: { id: string; archetype: string }): void {
    let card = memePitchCards.get(spec.id);
    if (!card) {
      card = createPitchCard({ parent: document.body, vcName: spec.archetype, who: spec.archetype,
        kicker: 'SIDE QUEST', roundLabel: 'SIDE QUEST', cancellable: true, onPitch: line => postFounderPitch(line, undefined, spec.id) });
      memePitchCards.set(spec.id, card);
    }
    card.show();
  }
  // Phase-6 Series A Demo Day pitch: REUSE the ladder pitch card, targeting the fictional hacker house (vcId =
  // FOUNDER_SERIES_A_ID — no parallel pitch/judge path). A credited pitch is floored to the Series A threshold
  // on the server (handlePitchTap + founderSeriesAFloor, stage-gated) with the per-SF-day cooldown.
  function openSeriesAPitch(): void {
    if (!seriesAPitchCard) seriesAPitchCard = createPitchCard({ parent: document.body, vcName: FOUNDER_SERIES_A_NAME,
      who: 'the Demo Day panel', kicker: 'DEMO DAY', roundLabel: 'SERIES A', cancellable: true, onPitch: line => postFounderPitch(line, FOUNDER_SERIES_A_ID),
      // A credited Series A close "hires" the cosmetic teammate crew (follows the player; no gameplay effect).
      onDone: result => { if (result?.credited) founderFollowers?.hire(); } });
    seriesAPitchCard.show();
  }
  // guidedOpener (gtasf-dzrrn): the ~20 s move → highlighted car → drive-to-Pear-VC tutorial. The ladder runs it (once
  // per device) before the first walk-up pitch; the controls panel shows every session until dismissed.
  const openerTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (flags.guidedOpener && flags.founderLadder && flags.actionOpening && flags.pitching && flags.driving && flags.hud) {
    guidedOpener = createGuidedOpener({ root: landmarks, isTouch: openerTouch, partnerFirm: FOUNDER_PLAZA_VC_NAME,
      startupName: () => funding?.profile?.startupName || undefined,
      player: () => { const at = mode === 'driver' && driving ? driving : foot; return { x: at.x, y: foot.y, z: at.z, mode }; },
      cars: () => [...fleet.cars.values()].filter(car => !(car.data.flags & POLICE_FLAG) && vehicleEntryMode(car.data) === 'driver'
        && Math.hypot(car.model.root.position.x - foot.x, car.model.root.position.z - foot.z) < 90)
        .map(car => ({ id: car.data.id, x: car.model.root.position.x, y: car.model.root.position.y, z: car.model.root.position.z })),
      partner: () => {
        const at = founderPlazaInvestor?.position ?? placePoint(founderPlazaAngel(true));
        return { x: at.x, y: world.surfaceHeightAt(at.x, at.z) ?? undefined, z: at.z };
      },
      partnerActive: () => Boolean(founderLadderFlow?.preSeedPitchEligible),
      heightAt: (x, z) => world.surfaceHeightAt(x, z),
      route: dest => {
        if (!dest) { guidance?.setDestination(null); return; }
        const d: RadarDestination = { id: `opener:${dest.title}`, title: dest.title, x: dest.x, y: world.surfaceHeightAt(dest.x, dest.z) ?? foot.y, z: dest.z, walkingStop: true };
        selectedDestination = d; radar?.setDestination(d); guidance?.setDestination(d);
      },
      onStep: step => trackAnalytics('opening_step', { step: `opener_${step}`, is_mobile: isMobileDevice() }),
    });
  }
  if (flags.guidedOpener && flags.hud) createControlsPanel({ isTouch: openerTouch, combat: flags.combat && flags.weapons, lockOn: flags.aimControls });
  founderLadderFlow = await mountFounderLadder({
    openingDrive, // critique #13: this new player spawned in the opening car — drive to Pear VC first
    pearFar: Boolean(guidedOpener), pearWhere: guidedOpener ? 'down the Embarcadero' : undefined,
    // A deep-link arrival (share/organiser link, ?at=) keeps its destination landing; the opener waits for a plain visit.
    guidedOpener: guidedOpener ? { pending: () => !request.explicit && openerPending(), start: done => guidedOpener?.start(done) } : undefined,
    isTouch: matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0,
    // After Seed: "Find a job" opens the jobs phone (missions + SF pilgrimage). missionPhone mounts with the scenery.
    openJobs: flags.missions ? () => missionPhone?.show() : undefined,
    // actionOpening (critique #13): skip the naming modal with the profile's generated name; the pitches happen at real
    // places (the Pear VC partner on the plaza, First Round's office) the GPS routes to.
    defaultStartupName: () => funding?.profile?.startupName || null,
    places: {
      pear: () => founderPlazaInvestor ? { x: founderPlazaInvestor.position.x, z: founderPlazaInvestor.position.z } : placePoint(founderPlazaAngel(flags.guidedOpener)),
      seed: () => {
        const firm = PITCH_VCS.find(vc => vc.id === FOUNDER_SEED_VC_ID);
        if (!firm || !world) return null;
        const p = projectLocation(firm.lat, firm.lon, world.manifest.frame); return { x: p.x, z: p.z };
      },
    },
    facePoint: p => { // the walk-up partner in view after the billboard swing
      if (mode !== 'on-foot' || appDisposed) return;
      foot.yaw = Math.atan2(p.x - foot.x, p.z - foot.z); player.rotation.y = foot.yaw;
      camera.recenter(foot.yaw); movementYaw = camera.yaw;
    },
    route: dest => {
      if (!dest) { guidance?.setDestination(null); return; }
      const d: RadarDestination = { id: `founder:${dest.title}`, title: dest.title, x: dest.x, y: world.surfaceHeightAt(dest.x, dest.z) ?? foot.y, z: dest.z, walkingStop: true };
      selectedDestination = d; radar?.setDestination(d); guidance?.setDestination(d);
    },
    saveStartup: async (name, fallbackNick) => { await funding?.saveIdentity(name, funding?.profile?.nickname || fallbackNick); },
    // Build the startup's billboard at the Embarcadero and swing the camera to it (reuses the arrival
    // look-at: spawn.focus + introUntil frame it; recenter eases the orbit so it's a swing, not a cut).
    showBillboard: async ({ name }) => {
      founderBillboard?.dispose();
      // openingDrive: ahead-right of the car (55° off its heading, toward the waterfront promenade), not down the roadway.
      const aside = openingDrive ? spawn.yaw - 55 * Math.PI / 180 : 0;
      founderBillboard = await createFounderBillboard({ root: landmarks, world, name, faceToward: { x: spawn.x, z: spawn.z },
        toward: openingDrive ? { x: spawn.x + Math.sin(aside) * 60, z: spawn.z + Math.cos(aside) * 60 } : undefined });
      spawn.focus = founderBillboard.center;
      camera.recenter(Math.atan2(foot.x - founderBillboard.center.x, foot.z - founderBillboard.center.z) - Math.PI);
      introUntil = performance.now() + 4800;
      await new Promise(resolve => setTimeout(resolve, 3200)); // let the swing settle + a few frames render
      // gtasf-qvajw: the share card that shows this shot is classic-only; the action opening skips it, so skip the ~55 ms
      // (4x phone) canvas encode in the first seconds after READY.
      if (!flags.actionOpening) founderBillboardShot = await requestCapture(); // the real in-world billboard, for the share card
      await new Promise(resolve => setTimeout(resolve, 900));
      if (!appDisposed) { introUntil = 0; camera.recenter(foot.yaw); }
    },
    // The share card shows the real in-world billboard render captured during the swing (falls back to drawn).
    billboardShot: () => founderBillboardShot,
    // Share link spawns a visitor in front of the billboard (the Ferry plaza spawn pose), reusing ?at=.
    copyShareLink: () => copyLocation({ x: spawn.x, z: spawn.z, yaw: spawn.yaw }),
    // Same deep link without copying, to pre-fill the share card's "Share on X" compose intent — the
    // player posts from their own X account (we never post). Referral-wrapped for inbound attribution.
    shareUrl: () => referralShareUrl(locationLink({ x: spawn.x, z: spawn.z, yaw: spawn.yaw })),
    // Phase 2 first pitch (tap fallback): send the chosen line INDEX to the server; feed the returned
    // profile to the funding HUD so the valuation pill reveals (Pre-seed). Returns the judged result.
    // Only wired when flags.pitching is on — otherwise the controller skips the pitch step straight to the
    // game, so a founderLadder-on / pitching-off build (current prod) never strands a player after share.
    pitchStartup: !flags.pitching ? undefined : lineIndex => postFounderPitch(lineIndex),
    // Phase 3 — Seed pitch at the VC office: same POST, but targets the Seed firm (server resolves vcId).
    pitchSeed: !flags.pitching ? undefined : lineIndex => postFounderPitch(lineIndex, FOUNDER_SEED_VC_ID),
    // Phase 3 — Seed quest swoop: hail a robotaxi to the First Round office; resolve once it drops the
    // player there (the pitch itself has no proximity gate, so the ride is the experience, not a lock).
    isConnected: () => connected,
    // gtasf-5fq7n: a hail on a down world socket waited 0.2 s and said 'No robotaxi right now'. Wait for the reconnect
    // (<= 10 s, the ws client owns the retries), THEN hail once; still down -> 'offline' (the controller says so).
    hailToVcOffice: !flags.pitching ? undefined : onRiding => new Promise<void>((resolve, reject) => {
      const firm = PITCH_VCS.find(vc => vc.id === FOUNDER_SEED_VC_ID);
      if (!firm || !world) { reject(new Error('no office')); return; }
      const point = projectLocation(firm.lat, firm.lon, world.manifest.frame);
      const dest = { x: point.x, z: point.z, y: world.surfaceHeightAt(point.x, point.z) ?? 0, title: firm.name };
      const go = () => {
        seedRide = { resolve, reject };
        if (!hailSelectedTaxi(dest)) { seedRide = null; reject(new Error('could not hail')); return; }
        onRiding?.();
      };
      if (connected) { go(); return; }
      const since = performance.now();
      const wait = setInterval(() => {
        if (appDisposed) { clearInterval(wait); reject(new Error('disposed')); return; }
        if (connected) { clearInterval(wait); go(); }
        else if (performance.now() - since > 10_000) { clearInterval(wait); reject(new Error('offline')); }
      }, 250);
    }),
    // Founder-ladder funnel (gated on flags.posthogAnalytics inside track): bucket denominator,
    // startup founded, billboard first seen (the "billboard within 2 min" success metric).
    onBucket: ({ bucket }) => trackAnalytics('founder_bucket', { bucket, is_mobile: isMobileDevice() }),
    onFounded: ({ bucket }) => trackAnalytics('founder_found', { bucket, is_mobile: isMobileDevice() }),
    onBillboardSeen: ({ msSinceJoin, bucket }) => trackAnalytics('billboard_seen', { bucket, ms_since_join: Math.round(msSinceJoin), is_mobile: isMobileDevice() }),
    onOpeningStep: ({ step, msSinceJoin }) => trackAnalytics('opening_step', { step, ms_since_join: Math.round(msSinceJoin), is_mobile: isMobileDevice() }), // funnel beats
  });
  if (founderLadderFlow.active) {
    // Ladder bucket: show the EARNED crown (top live valuation) + mini leaderboard, and hide the paid OUTBID
    // banner via the body class (control/OUTBID untouched). The HUD lock keeps the crown hidden until Seed.
    document.body.classList.add('gt-founder-ladder');
    founderCrown = createFounderCrown(document.body);
    if (flags.founderRank) void refreshFounderRank();
    founderCrown.set({ rank: fundingProfile?.rank ?? null, total: crownBoardTotal, crownHolder: latestLeaders[0]?.startupName ?? null });
  }
  if (!founderLadderFlow.active) onboarding = await setupOnboarding({
    isTouch: matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0,
    requestIdentity() { if (identityScreen) identityScreen.open(); else onboarding?.stepCleared('identity'); },
    onSkipped() { if (!funding?.profile?.startupName) identityScreen?.open(); }, // skippers still need a name to be paid
    // Organiser links (/e/<id>) arrive at the venue: paint that, not the Ferry.
    paintTarget: request.place.organiser ? (!request.place.approx && request.place.organiser.venue ? request.place.organiser.venue : 'the venue') : undefined,
  });
  // "What's new" is for returning players only (whatsNew.showOnce silently marks everything seen when this
  // browser has no record). Never stack it on the tutorial (paint step onward) or an /e organiser card.
  // (Every profile now has a generated startup name, so a saved name no longer means "returning".)
  if (!organiserPlace && (!onboarding || onboarding.state.completed)) whatsNew?.showOnce();
  if (onboarding) {
    tutorial = createTutorialDriver({ flow: onboarding, isTouch: matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 });
    tutorialBeacon = createTutorialBeacon(scene, surface.heightAt);
    const replayBtn = document.createElement('button'); replayBtn.type = 'button';
    replayBtn.className = 'gt-angel-launch'; replayBtn.textContent = 'Replay tutorial';
    replayBtn.addEventListener('click', () => { gameOptions.hide(); onboarding?.replay(); });
    gameOptions.content.append(replayBtn);
  }
  // Play-time analytics: consented 60 s heartbeat while visible and in-world (boot is past READY here).
  const stopHeartbeat = startSessionHeartbeat(() => ({ inWorld: !appDisposed,
    step: onboarding ? onboardingStepName(onboarding.state) : undefined, stage: currentRound?.id }));
  addEventListener('pagehide', stopHeartbeat, { once: true });
  // Friends & DMs panel (PLAN-v2.1 decision 5 chat row). Dev-only until flags.friends ships; self-mounts
  // a "👥 Friends" button into Game options and talks to pane 13's /api/friends/* via the shared client.
  friendsPanel = flags.friends ? createFriendsPanel({ parent: gameOptions.content, onModalChange(open) {
    input?.release(); keyboard?.release();
    if (open) {
      radar?.toggleMap(false); hud?.hideEvent(); upcoming?.toggle(false); outbid?.hide(); fundingHud?.hide(); fundingPerks?.hide(); referralPanel?.hide(); gameOptions?.hide(); chat?.hide(); wardrobe?.hide(); closeInspectionDialogs('friends'); whatsNew?.close(); eventSubmit?.close(); feedback?.close(); becomeAnAngel?.close();
      releaseFriendsCursor ??= holdFreeCursor();
      if (document.pointerLockElement) document.exitPointerLock();
    } else { releaseFriendsCursor?.(); releaseFriendsCursor = undefined; }
  } }) : null;
  document.querySelector<HTMLElement>('#place-name')!.textContent = request.place.title;
  // HOTFIX (orchestrator 2026-10-03): never AUTO-OPEN the legacy "Name your startup" modal. It grabbed
  // keyboard focus on first visit, so pressing W to walk typed "wm" into the name field and trapped new
  // players. The modal stays reachable on explicit click (funding identity button); the post-first-payout
  // identity screen (onboarding, pane 14) replaces up-front naming. Just nudge — non-modal, never steals keys.
  if (fundingProfile && (!fundingProfile.startupName || !worldNickname)) {
    notify(fundingProfile.nickname && !worldNickname
      ? 'Your saved nickname needs a shorter name — set it in Game options.'
      : 'Name your startup any time from Game options.', 8000);
  }
  pauseMenu = createPauseMenu({
    // Esc belongs to an open weapon wheel / jobs phone first (they close on it), not the pause menu over them. [gtasf-qa]
    canOpen: () => !hasModal() && !document.querySelector('dialog[open]') && !admissionBlocked() && !document.querySelector('.gt-sa-intro')
      && !document.querySelector('.gt-weapon-wheel:not([hidden])') && !missionPhone?.isOpen,
    onHorn: () => actions.emit('horn', undefined),
    onChangelog: () => whatsNew?.openHistory(),
    onJobs: flags.missions ? () => missionPhone?.show() : undefined,
    onChange(open) {
      input?.release(); keyboard?.release(); mx = mz = 0; run = false;
      if (open) { releasePauseCursor ??= holdFreeCursor(); if (document.pointerLockElement) document.exitPointerLock(); }
      else { releasePauseCursor?.(); releasePauseCursor = undefined; }
    },
  });
  function update(dt: number, now: number) {
    // gtasf-3k35: reset the per-frame "one heavy mount stage" grant before any stage update runs.
    beginHeavyFrame();
    // Camera easing/its 1.5-second manual hold follow elapsed time even when physics caps a long frame.
    const cameraDt = lastCameraFrame === undefined ? dt : Math.max(0, (now - lastCameraFrame) / 1000);
    lastCameraFrame = now;
    input?.touch.setMode(mode, fleet.cars.get(vehicleId)?.data.kind === 'cable-car');
    radio?.setVehicle(mode !== 'on-foot' || Boolean(quickRide?.active));
    input?.poll(dt);
    keyboard?.poll(dt);
    const modalOpen = hasModal();
    if (input && input.source !== 'virtual' && (mx || mz || input.look.x || input.look.y || input.steer || input.throttle || input.brake || input.held('handbrake'))) net?.activity();
    if (mx || mz || input?.look.x || input?.look.y) { introUntil = 0; lastInputMs = now; }
    let speed = 0;
    if (mx !== previousMoveX || mz !== previousMoveZ || input?.look.x || input?.look.y) movementYaw = camera.yaw;
    previousMoveX = mx; previousMoveZ = mz;
    if (!relocation && mode === 'on-foot') {
      // On a personal ride (flags.personalRides), move at the ride's speed instead of walk/sprint.
      const mountSpeedMps = rideSystem && currentRound ? rideSystem.mountSpeed(currentRound) : 0;
      const speedScale = mayhem ? mayhem.speedScale(performance.now()) : 1; // water-balloon slow (playful mayhem)
      if (tankControls) {
        if (!modalOpen) foot.yaw -= mx * 2.4 * dt;
        const heading = foot.yaw;
        speed = updateOnFoot(foot, { x: 0, z: modalOpen ? 0 : mz, run, mountSpeedMps, speedScale }, heading + Math.PI, dt, surface);
        foot.yaw = heading;
      } else {
        // Keep the held direction stable while the chase camera swings behind the walking player.
        speed = updateOnFoot(foot, { x: modalOpen ? 0 : mx, z: modalOpen ? 0 : mz, run, mountSpeedMps, speedScale }, movementYaw, dt, surface);
      }
      rideSystem?.update(foot); // park the ride mesh under the avatar (no-op when dismounted)
    }
    if (!relocation && mode === 'driver' && driving) {
      const speedBeforeDrive = driving.speed;
      const holdCar = modalOpen || seatAnim?.kind === 'enter'; // carEnterAnim: no driving off while still climbing in
      updateDriving(driving, { steer: holdCar ? 0 : input?.steer ?? mx, throttle: holdCar ? 0 : input?.throttle ?? Math.max(0, -mz), brake: holdCar ? 0 : input?.brake ?? Math.max(0, mz), handbrake: holdCar || (input?.held('handbrake') ?? false) }, dt, surface);
      if (stunts && !modalOpen) { // stuntBonus: real hill air in a car -> GTA-style splash (client-only)
        const jump = stunts.update(driving, performance.now());
        if (jump) { // the first jump off each named street is a UNIQUE STUNT (once per device)
          const street = world!.locationNameAt(jump.from.x, jump.from.z, 80, driving.y)?.street ?? null;
          const unique = street ? stunts.markStreet(street) : false;
          const stats = `${Math.round(jump.distanceM)} m · ${(jump.airMs / 1000).toFixed(1)} s air`;
          saMissionStinger(unique ? 'UNIQUE STUNT' : jump.best ? 'STUNT BONUS · NEW BEST' : 'STUNT BONUS', { sub: unique ? `${street} · ${stats}` : stats, variant: 'orange', holdMs: 2400 });
        }
      }
      // gtasf-d14ck: the controller stops a car dead on a wall/kerb step; at speed that's a crash (the server caps the
      // closing speed by the car's measured speed and stops crash damage at burning).
      // drivingFeel (critique #10): the controller bounces off walls instead, reporting the impact speed in wallHit.
      const wallSpeed = flags.drivingFeel ? Math.abs(driving.wallHit ?? 0) : Math.abs(driving.speed) < .5 ? Math.abs(speedBeforeDrive) : 0;
      if ((flags.vehicleDamage || flags.drivingFeel) && wallSpeed >= 4) {
        const hard = Math.min(1, wallSpeed / 14);
        playCrunch(.3 + hard * .7); cameraShake = Math.max(cameraShake, .08 + hard * .3); cameraShakeUntil = performance.now() + (flags.drivingFeel ? 150 : 200) + hard * 300;
        if (flags.vehicleDamage) net?.send({ type: 'VEHICLE_CRASH', closing: wallSpeed });
      }
      if (skids) { // sliding = handbrake drift or a hard stop (>20 m/s² — braking, not coasting) on the ground
        const decel = (Math.abs(speedBeforeDrive) - Math.abs(driving.speed)) / Math.max(dt, 1e-3);
        skidCar = { x: driving.x, y: driving.y, z: driving.z, yaw: driving.yaw, intensity: Math.min(1, Math.abs(driving.speed) / 25),
          sliding: !driving.airborne && !driving.wallHit && Math.abs(driving.speed) > 5 && (Math.abs(driving.slip) > .05 || decel > 20),
          heightAt: (x, z) => world!.heightAt(x, z) };
      }
      if (flags.policeRam && (ramShove.vx || ramShove.vz)) {
        driving.x += ramShove.vx * dt; driving.z += ramShove.vz * dt;
        const k = Math.exp(-3 * dt); ramShove.vx *= k; ramShove.vz *= k;
        if (Math.hypot(ramShove.vx, ramShove.vz) < .05) ramShove.vx = ramShove.vz = 0;
      }
      if (flags.carCollisions) {
        // Real contact (gtasf-4g29): car-shaped capsules for every nearby fleet car (traffic, robotaxis, buses,
        // other players) and shown kerb cars; a fresh hit crunches, shakes the camera and nudges an AI car.
        contactBodies.length = 0;
        for (const [id, car] of fleet.cars) {
          if (id === vehicleId || !car.model.root.visible) continue;
          const p = car.model.root.position;
          if (Math.abs(p.x - driving.x) > 12 || Math.abs(p.z - driving.z) > 12) continue;
          const kind = car.data.kind, long = kind === 'bus' ? 4.6 : kind === 'cable-car' ? 3.2 : 1.3;
          const yaw = car.model.root.rotation.y, v = (car.data.speedCmps ?? 0) / 100; // server speed along its heading
          contactBodies.push({ x: p.x, z: p.z, yaw, half: long, radius: kind === 'bus' || kind === 'cable-car' ? 1.3 : 1.0, id, vx: Math.sin(yaw) * v, vz: Math.cos(yaw) * v });
        }
        let kerbId = -1;
        for (const k of kerbCarBodies()) {
          if (Math.abs(k.x - driving.x) < 12 && Math.abs(k.z - driving.z) < 12) contactBodies.push({ x: k.x, z: k.z, yaw: k.yaw, half: 1.25, radius: 1.0, id: kerbId });
          kerbId--;
        }
        const hit = contactBodies.length ? carContact.resolve(driving, speedBeforeDrive, contactBodies, performance.now()) : null;
        if (hit) {
          const strength = Math.min(1, hit.closing / 14);
          carContactStats.hits++; carContactStats.last = { id: hit.id, closing: hit.closing, speedAfter: driving.speed };
          // Ramming an SFPD car at speed is a crime (streetCrimeWanted): confess it so the server raises a cop-hit.
          if (flags.streetCrimeWanted && hit.id >= POLICE_ID_BASE && hit.closing >= 5 && (!flags.policeRam || Math.abs(speedBeforeDrive) >= 5)) reportPedWasted(2);
          playCrunch(.25 + strength * .75);
          cameraShake = Math.max(cameraShake, .06 + strength * .32); cameraShakeUntil = performance.now() + 180 + strength * 320;
          if (flags.vehicleDamage && hit.closing >= 4 && !(flags.policeRam && hit.id >= POLICE_ID_BASE)) net?.send({ type: 'VEHICLE_CRASH', closing: hit.closing }); // own-car crash damage (police rams are server-applied)
          const other = hit.id > 0 ? fleet.cars.get(hit.id) : undefined;
          // AI cars (no player driver) are shoved client-side; another player's car is theirs to move.
          if (other && other.data.driverId === 0 && other.data.kind !== 'bus' && other.data.kind !== 'cable-car') {
            const nudge = carNudges.get(hit.id) ?? { x: 0, z: 0, vx: 0, vz: 0 };
            const shove = Math.min(4, hit.closing * .5);
            nudge.vx -= hit.nx * shove; nudge.vz -= hit.nz * shove; carNudges.set(hit.id, nudge);
          }
        }
      } else {
        // Loose arcade car-vs-car bumps: shove off any nearby other car (symmetric — both owners separate client-side).
        const nearby: { x: number; z: number }[] = [];
        for (const [id, car] of fleet.cars) {
          if (id === vehicleId || car.data.kind === 'cable-car' || car.data.kind === 'bus') continue;
          const p = car.model.root.position;
          if (Math.abs(p.x - driving.x) < 6 && Math.abs(p.z - driving.z) < 6) nearby.push({ x: p.x, z: p.z });
        }
        if (nearby.length) applyCarBumps(driving, nearby, dt);
      }
      // Roof guard (gtasf-roof-fix, #5.46 dense map): a car must never use a building roof as drivable
      // ground. If the driven car has come to rest on top of a building (above the road network, on a
      // footprint) — e.g. after a hill/jump launched it onto rowhouse roofs — stop it on the spot and ask
      // the server to recover it to the nearest road (road-graph snap, works on dense maps; rate-limited).
      if (flags.roadRespawn && !driving.airborne && isOnBuildingRoof(world!, driving.x, driving.z, driving.y)) {
        driving.speed = 0; driving.slip = 0; driving.vy = 0; driving.bumpVx = 0; driving.bumpVz = 0; driving.bumpSpin = 0;
        if (now - lastRoofRecover > 1500) { lastRoofRecover = now; recoverRoad(); }
      }
      // Hang recovery (gtasf carHangRecovery, @ktwu01): a car stuck hovering — no terrain under it, or hovering
      // > 4 m up with ~zero vertical velocity — for more than ~1.5 s recovers to the nearest road. Catches the
      // cases the controller's fall fix and the roof guard miss (a footprint gap under the car, a persistent
      // void); the controller fix handles the common "fall as the spawn chunk streams in" case without this.
      if (flags.carHangRecovery && flags.roadRespawn) {
        const groundH = world!.heightAt(driving.x, driving.z);
        const sampled = groundH !== null && Number.isFinite(groundH);
        const hang = advanceHangRecovery(hangMs, dt * 1000, { groundSampled: sampled,
          heightAboveGround: sampled ? driving.y - groundH! : 0, verticalSpeed: driving.vy });
        hangMs = hang.hangMs;
        if (hang.recover && now - lastHangRecover > 3000) { lastHangRecover = now; recoverRoad(); }
      } else hangMs = 0;
      Object.assign(foot, driving); speed = driving.speed;
    }
    fleet.update(dt, mode === 'on-foot' ? 0 : vehicleId, driving, surface, net?.clock.serverNow(),
      { x: camera.camera.position.x, z: camera.camera.position.z, range: foundation.tier === 'low' ? 260 : 450 });
    // AI cars hit by the driven car: a damped spring offset on top of their server pose (nudged, then settles back).
    for (const [id, nudge] of carNudges) {
      const car = fleet.cars.get(id);
      nudge.vx += (-14 * nudge.x - 5 * nudge.vx) * dt; nudge.vz += (-14 * nudge.z - 5 * nudge.vz) * dt;
      nudge.x += nudge.vx * dt; nudge.z += nudge.vz * dt;
      if (!car || (Math.hypot(nudge.x, nudge.z) < .01 && Math.hypot(nudge.vx, nudge.vz) < .02)) { carNudges.delete(id); continue; }
      car.model.root.position.x += nudge.x; car.model.root.position.z += nudge.z;
    }
    const occupied = mode !== 'on-foot' ? fleet.cars.get(vehicleId) : undefined;
    if (occupied) {
      if (mode === 'passenger') { foot.x = occupied.model.root.position.x; foot.y = occupied.model.root.position.y; foot.z = occupied.model.root.position.z; foot.yaw = occupied.model.root.rotation.y; speed = occupied.data.speedCmps / 100; }
      const entering = seatAnim?.kind === 'enter' && seatAnim.carId === vehicleId ? seatAnim : null;
      if (entering) { placeSeatAnim(entering, player, occupied.model, dt, foot); if (entering.done) seatAnim = null; } // carEnterAnim
      else {
        if (player.parent !== occupied.model.seat) occupied.model.seat.add(player);
        player.position.set(0, 0, 0); player.rotation.set(0, 0, 0);
      }
      occupied.model.cameraTarget.getWorldPosition(cameraFeet);
    } else if (seatAnim?.kind === 'exit' && fleet.cars.get(seatAnim.carId)) {
      // carEnterAnim: ease out of the seat to the door, then walk to the kerb spot the server placed us on (foot).
      const leaving = seatAnim;
      if (placeSeatAnim(leaving, player, fleet.cars.get(leaving.carId)!.model, dt, foot) === 'walk') foot.yaw = player.rotation.y; // keep the walk-away heading: no snap back
      if (leaving.done) seatAnim = null;
      cameraFeet.set(foot.x, foot.y, foot.z);
    } else if (rideCinematic) {
      // eventRideDrive: ease from 0 to ~12 m/s along the road heading; the camera rides the car.
      const ride = rideCinematic; ride.t += dt;
      const speedNow = Math.min(12, ride.t * 9), distance = ride.t < 1.33 ? 4.5 * ride.t * ride.t : 8 + 12 * (ride.t - 1.33);
      placeRideCar(ride, distance); ride.car.update(dt, speedNow, 0);
      if (player.parent !== ride.car.seat) ride.car.seat.add(player);
      player.position.set(0, 0, 0); player.rotation.set(0, 0, 0);
      ride.car.cameraTarget.getWorldPosition(cameraFeet);
    } else {
      if (player.parent !== scene) scene.add(player);
      // footRenderedGround (gtasf-r1fpj): on steep blocks the drawn road sits above the road-graph height the player walks on
      // (Hyde St at Bush: 64.68 m drawn vs 64.33 m) and the body sank to mid-thigh. Draw the avatar on the visible surface;
      // foot.y (physics, sent to the server) is unchanged. Upward corrections only (<= 8 m), never across decks.
      let avatarY = foot.y;
      if (flags.footRenderedGround) {
        // Nothing drawn within 5 m of foot.y means the player stands on no drawn surface at all (a real lower deck, e.g. a road
        // under an overpass, is found by the first lookup), so look again centred 5 m up: lane D's uncapped probe (gtasf-8mjjf)
        // found graph-under-drawn gaps of 5.6-7.2 m (14th Ave, Koret Way, Crestmont, Burnside, Foerster).
        const drawn = world?.renderedGroundHeightAt(foot.x, foot.z, foot.y) ?? world?.renderedGroundHeightAt(foot.x, foot.z, foot.y + 5) ?? null;
        // renderedGroundHeightAt returns the drawn surface CLOSEST to foot.y (within 5 m), so on a real lower deck
        // (under an overpass) it returns that deck and nothing lifts; it only lifts when no surface is drawn near foot.y at all
        // (St. Mary's / Stanyan: road graph 91.69 m under a hill drawn at 95.36 m -> player buried, camera in the slope).
        if (drawn !== null && drawn > foot.y && drawn - foot.y < 8) avatarY = drawn;
      }
      player.position.set(foot.x, avatarY, foot.z); player.rotation.set(0, foot.yaw, 0); cameraFeet.set(foot.x, avatarY, foot.z);
    }
    vehicleAudio?.update(fleet.cars, { ...foot, yaw: camera.yaw }, vehicleId, speed);
    skids?.update(dt, mode === 'driver' ? skidCar : null); skidCar = null;
    if (engineVoice) { // sampledAudio: a recorded engine for the car you drive (EVs and robotaxis stay quiet)
      const kind = occupied?.data.kind, combustion = mode === 'driver' && kind !== undefined && kind !== 'tesla' && kind !== 'robotaxi' && kind !== 'cable-car';
      engineVoice.setLevel(combustion ? 0.1 + Math.min(1, Math.abs(speed) / 25) * 0.08 : 0, engineRate(speed));
    }
    sfx?.update({ x: foot.x, z: foot.z, speed, mode, dt });
    feet.set(foot.x, foot.y, foot.z); world!.update(quickRide?.destination ?? feet);
    // Aerial far-LOD ring (aerialFarChunks): fill the mid-ground with cheap coarse chunks when the camera lifts
    // high above the player's ground; a no-op (and frees them) at street level. Centred on the camera, not the
    // player, so it follows the view on a lift-off / fly-over.
    { const cp = camera.camera.position; world!.updateFar(cp.x, cp.z, cp.y - foot.y); }
    streetProps?.update(foot, now, net?.clock.serverNow(), mode === 'driver' && driving ? { x: driving.x, z: driving.z } : null); cityLife?.update(foot, now);
    parkedVehicles?.update(foot, now);
    founderLadderFlow?.update(mode === 'driver' && driving ? driving : foot); // actionOpening: Seed arrival + an open conversation closes when you leave
    guidedOpener?.update(now);
    parodyBillboards?.update(foot, now); roadDetails?.update(foot); skyAds?.update(dt, now);
    founderCityBillboards?.update(foot, net?.clock.serverNow() ?? Date.now());
    founderPlazaInvestor?.update(dt);
    founderMemeNpcs?.update(dt);
    founderDemoDay?.update(dt);
    founderMissionGivers?.update(dt, missionObjective?.mission.id ?? null);
    if (founderFollowers?.hired) founderFollowers.update({ x: foot.x, z: foot.z, yaw: foot.yaw }, dt);
    if (flags.questYieldsToCenter && flags.centerSlotQueue) founderLadderFlow?.centerHold(centerSlot.busy); // critic N42
    // heistGetaway: once you're driving, the 'Getaway car' line pointed at the car you're sitting in. Point it at the next stop
    // instead (lane E run 6: with no line leading away, the escape had no direction); losing the heat on the way completes the
    // escape, and the deliver leg then routes itself. No next stop: just drop the line.
    if (flags.heistGetaway && mode === 'on-foot' && selectedDestination.id === 'getaway-car' && getawayTarget?.vehicleId !== undefined) {
      const car = fleet?.cars.get(getawayTarget.vehicleId);
      const p = car?.model.root.position;
      if (!car || car.data.driverId || !p || Math.hypot(p.x - getawayTarget.x, p.z - getawayTarget.z) > 3) routeGetaway(false); // it left: pick another
    }
    if (flags.heistGetaway && mode === 'driver' && selectedDestination.id === 'getaway-car') {
      const next = missionObjective?.objective.kind === 'escape' ? missionObjective.mission.objectives[missionObjective.index + 1] : undefined;
      if (next?.at) {
        const p = placePoint(next.at);
        routeDestination({ id: 'heist-onward', title: 'Next stop: lose them on the way', x: p.x, y: world?.surfaceHeightAt(p.x, p.z) ?? foot.y, z: p.z, walkingStop: true });
      } else { radar?.setDestination(null); guidance?.setDestination(null); selectedDestination = { ...selectedDestination, id: undefined, title: '' }; }
    }
    cofounderRecruits?.update({ x: foot.x, z: foot.z, yaw: foot.yaw }, dt, mode !== 'on-foot');
    // Plot quest-givers on the radar so they're findable: the meme NPCs (phase-5.1, memeQuests), and the Pear VC
    // plaza investor while a free-roam Pre-seed pitch is still open — the minimap nudge that points returning
    // players at their first pitch. Cleared once Pre-seed closes (eligible → false drops it from the list). [gtasf-ldlm]
    if (founderMemeNpcs || founderPlazaInvestor) {
      const questGivers: { x: number; z: number }[] = founderMemeNpcs ? founderMemeNpcs.all().map(n => ({ x: n.x, z: n.z })) : [];
      if (founderPlazaInvestor && founderLadderFlow?.preSeedPitchEligible) questGivers.push({ x: founderPlazaInvestor.position.x, z: founderPlazaInvestor.position.z });
      radar?.setQuestGivers(questGivers);
    }
    founderDriveQuest?.update(foot, mode !== 'on-foot'); // drive-quest HUD + escape detection (no-op when idle)
    if (flags.personalCar) { // personal car: re-read after leaving a car you drove; hide the blip while you're in it
      if (mode !== personalCarMode) {
        if (personalCarMode === 'driver' && mode === 'on-foot') schedulePersonalCar(800);
        else if (mode === 'driver' && personalCarSpot && driving && Math.hypot(driving.x - personalCarSpot.x, driving.z - personalCarSpot.z) < 6) personalCarSpot = { ...personalCarSpot, driving: true };
        personalCarMode = mode;
      }
      radar?.setPersonalCar(personalCarSpot && !personalCarSpot.driving ? personalCarSpot : null);
    }
    pilgrimageTracker?.update(foot); // SF pilgrimage: claim a landmark on arrival (server-validated)
    // LANE C missions + time trials share the gold lettered-marker layer: feed both the active waypoint (while a
    // job/run is live) or every available start, in ONE setMissionMarkers call so they don't overwrite each other.
    if (founderMissionRunner || founderTimeTrialRunner) {
      const letterMarkers: { x: number; z: number; letter: string }[] = [];
      if (founderMissionRunner) {
        // Quest-giver call: once per SF day per device, only for a player who has raised (never over the found→pitch
        // spine), never over a modal / the open phone / a running job; otherwise retry in 15 s.
        if (callAt && performance.now() >= callAt) {
          // hudFocus: nor over a payout card / result band / RANK UP / conversation (it rang over JOB DONE, taxi-fare evidence).
          const bigMoment = flags.hudFocus && !!document.querySelector('.gt-funding-toast:not([hidden]), .gt-mission-band.is-in, .gt-rank-up.is-in, .gt-convo:not([hidden])');
          if (hasModal() || missionPhone?.isOpen || founderMissionRunner.running || bigMoment || (currentRound?.id ?? 'bootstrapping') === 'bootstrapping') callAt = performance.now() + 15_000;
          else {
            callAt = 0;
            let rung = false; try { rung = localStorage.getItem('gtasf.phoneCall.day') === fundingDay(Date.now()); } catch { /* storage blocked: ring */ }
            if (!rung) { void ringQuestGiver?.(); try { localStorage.setItem('gtasf.phoneCall.day', fundingDay(Date.now())); } catch { /* best effort */ } }
          }
        }
        founderMissionRunner.update(foot, mode !== 'on-foot', mode === 'driver'); // advance objectives / escape (mirrors the drive quest)
        taxiFarePassenger?.update(dt);
        if (missionObjective?.waypoint) letterMarkers.push({ x: missionObjective.waypoint.x, z: missionObjective.waypoint.z, letter: missionObjective.mission.start.letter });
        else for (const m of MISSIONS) { if (!missionEnabled(m, flags)) continue; const p = placePoint(m.start); letterMarkers.push({ x: p.x, z: p.z, letter: m.start.letter }); }
      }
      if (founderTimeTrialRunner) {
        founderTimeTrialRunner.update(foot, mode !== 'on-foot');
        timeTrialGhostRacer?.update(performance.now() - timeTrialRunStartMs); // replay the personal-best ghost (no-op when hidden)
        // Live "vs best" delta: the player's elapsed minus the ghost's time when it was nearest this spot.
        if (timeTrialState && timeTrialGhost) {
          const gm = ghostTimeAtPosition(timeTrialGhost.samples, foot.x, foot.z);
          timeTrialHud?.setDelta(gm != null ? (performance.now() - timeTrialRunStartMs) - gm : null);
        } else timeTrialHud?.setDelta(null);
        if (timeTrialState) letterMarkers.push({ x: timeTrialState.waypoint.x, z: timeTrialState.waypoint.z, letter: timeTrialState.spec.start.letter });
        else for (const t of TIME_TRIALS) { const p = placePoint(t.start); letterMarkers.push({ x: p.x, z: p.z, letter: t.start.letter }); }
        // Discoverability: standing on a 'T' start in the right mode (no run active) prompts how to begin — the
        // marker is otherwise just a minimap letter with no world cue (missions have a "PRESS E TO START" giver).
        // Debounced to once per approach; prompt-radius == start-radius so the prompted E always actually starts it.
        if (!timeTrialState && !hasModal()) {
          const here = TIME_TRIALS.find(t => {
            const rightMode = t.mode === 'drive' ? mode !== 'on-foot' : mode === 'on-foot';
            if (!rightMode) return false;
            const p = placePoint(t.start);
            return Math.hypot(foot.x - p.x, foot.z - p.z) <= MISSION_ARRIVE_RADIUS_M;
          });
          if (here) {
            if (here.id !== timeTrialPromptId) {
              timeTrialPromptId = here.id;
              notify(`${here.title} — ${matchMedia('(pointer: coarse)').matches ? 'tap Enter / exit' : 'press E'} to start the time trial.`, 4000);
            }
          } else timeTrialPromptId = null;
        }
      }
      if (streetRaceClient) { streetRaceClient.update(foot); const g = streetRaceClient.marker; if (g) letterMarkers.push(g); letterMarkers.push(...streetRaceClient.rivalMarkers); }
      const bountyPin = bountyClient?.marker; if (bountyPin) letterMarkers.push(bountyPin);
      if (coopHeistClient) { coopHeistClient.update(foot); const c = coopHeistClient.marker; if (c) letterMarkers.push(c); }
      radar?.setMissionMarkers(letterMarkers);
    }
    landmarkNight?.update(foundation.nightLights?.stats.night ?? 0); placeStamps?.update(mode === 'driver' && driving ? driving : foot); placeSigns?.update(mode === 'driver' && driving ? driving : foot);
    adSlotMarkers?.update(camera.camera, foot, parodyBillboards?.stats.placed ?? []);
    if (now - lastLandmarkGround >= 1000) { updateLandmarkTerrain(landmarks, world!.surfaceHeightAt); plazaFurniture?.update(foot, now); lastLandmarkGround = now; }
    if (flags.wantedEscapeFlash && !flags.wantedEscape && now - lastEscapeCheck >= 250) { // blink the stars while out of police sight
      lastEscapeCheck = now;
      let seen = serverPoliceSight ?? false;
      if (wantedWatch > 0 && serverPoliceSight === undefined) for (const car of fleet.cars.values()) { // older server: distance guess
        if (!(car.data.flags & POLICE_FLAG)) continue;
        const p = car.model.root.position, sight = car.data.kind === 'supercar' ? HELICOPTER_SIGHT_M : POLICE_SIGHT_M;
        if (Math.hypot(p.x - foot.x, p.z - foot.z) <= sight) { seen = true; break; }
      }
      combat?.setEscaping(wantedWatch > 0 && !seen);
    }
    if (flags.streetCrimeWanted) reportVehicle(mode === 'driver' && driving ? { x: driving.x, z: driving.z, speed: driving.speed } : null); // run-over knockdowns
    streetWalkers?.update(foot, dt); ferryPedestrians?.update(foot, dt); coffeeQueue?.update(foot, dt); doloresWeekend?.update(foot, dt); angels?.update(foot, dt);
    // Surface the angels' throttled "rumour hint" (points at a nearby undiscovered investor's
    // neighbourhood) as a non-blocking info toast — never a modal (FB1). takeRumour self-throttles.
    // acquihireConfirm: a money prompt isn't outranked by flavour text; while it's up the rumour waits (not consumed). [lane E 14:4x]
    const streetRumour = flags.acquihireConfirm && performance.now() < acquihireArmedUntil ? null : angels?.takeRumour(foot, now);
    if (streetRumour) toasts.show({ title: 'Word on the street', detail: streetRumour, tone: 'info' });
    // Mirror the rumour on the radar as a faint zone (angels stay hidden); updates/clears each frame. [gtasf-radar-rumour-zone-wire-hoc5]
    radar?.setRumourZone(angels?.activeRumourZone(now) ?? null);
    hud?.update(radioHud);
    combat?.update(dt);
    combatVfx?.update(dt);
    if (combatVfxDemo && combatVfx) {
      combatVfxDemoAcc += dt;
      if (combatVfxDemoAcc >= 0.09) {
        combatVfxDemoAcc = 0;
        camera.camera.getWorldDirection(combatVfxDemoDir);
        const cx = foot.x, cy = foot.y + 1.4, cz = foot.z;
        const fh = Math.hypot(combatVfxDemoDir.x, combatVfxDemoDir.z) || 1, dist = 9 + Math.random() * 7;
        // Fire from the chest to a point on the ground ahead, so the impact sparks/dust/blood land on a surface.
        combatVfx.onShot({ from: [cx, cy, cz], to: [cx + combatVfxDemoDir.x / fh * dist, foot.y + 0.1, cz + combatVfxDemoDir.z / fh * dist],
          weapon: { melee: false } as unknown as ShotEvent['weapon'], hit: true, normal: [0, 1, 0] });
      }
    }
    policeLights?.update(fleet.cars.values(), now);
    if (now - lastLocationLabel >= 250) {
      streetHud?.update(world!.locationNameAt(foot.x, foot.z, 80, foot.y), now); lastLocationLabel = now;
    }
    if (flags.drivingFeel) camera.setDriveProfile(mode !== 'on-foot'); // critique #10: chase-cam profile in a car
    if (!modalOpen && introUntil === 0) camera.follow(foot.yaw, speed, cameraDt);
    cameraSafe = camera.update(cameraDt, cameraFeet);
    const arrivalView = Boolean(spawn.focus && performance.now() < introUntil);
    const fov = (arrivalView ? Math.max(84, followFov) : followFov) + (flags.drivingFeel ? camera.fovBoost : 0) - (flags.aimControls ? 6 * aimWeight : 0); // #10 speed FOV; aimControls aim zoom
    if (camera.camera.fov !== fov) { camera.camera.fov = fov; camera.camera.updateProjectionMatrix(); }
    if (spawn.focus && arrivalView) { camera.camera.lookAt(spawn.focus); camera.camera.updateMatrixWorld(); }
    // deathCamHold: the server CORRECTIONs a killed/arrested player to SF General ~0.3 s after the event, while the
    // WASTED/BUSTED card is still fading in (translucent), so the card played over the hospital. Hold the rendered camera
    // and body where they were until the card lifts; the world already streams around the new spot meanwhile.
    if (flags.deathCamHold) {
      if (combat?.dead && !deathHold) deathHold = { cam: camera.camera.position.clone(), quat: camera.camera.quaternion.clone(), body: player.position.clone(), yaw: player.rotation.y };
      else if (!combat?.dead) deathHold = null;
      if (deathHold) {
        camera.camera.position.copy(deathHold.cam); camera.camera.quaternion.copy(deathHold.quat); camera.camera.updateMatrixWorld();
        if (player.parent === scene) { player.position.copy(deathHold.body); player.rotation.y = deathHold.yaw; }
      }
    }
    if (flags.nearestHospitalRespawn && combat) { // the card just lifted: say where they woke (critic N20)
      if (wasDead && !combat.dead && pendingWake) notify(combat.lastDeath === 'busted' ? `Released outside ${pendingWake}.` : `Discharged from ${pendingWake}.`, 5000);
      if (wasDead && !combat.dead) pendingWake = null;
      wasDead = combat.dead;
    }
    // Label screen boxes must use the same final camera pose/FOV as this frame's render.
    markers?.update(foot, dt, mode === 'on-foot' && !modalOpen);
    if (flags.carNearDetail) setNearDetailFocus(foot.x, foot.z); // the car beside the player wins the HD swap (critic N5)
    worldEventLinks?.update(now);
    const seatClip = !seatAnim ? null : seatAnim.kind === 'enter' ? (seatAnim.t < SEAT_WALK_S ? 'walk' : null) : seatAnim.t < SEAT_SLIDE_S ? 'idle' : 'walk'; // carEnterAnim
    localAvatar?.update(dt, seatClip ?? (mode === 'driver' ? 'drive' : mode === 'passenger' ? 'sit' : rideSystem?.ride?.id ?? (speed > 4.2 ? 'run' : speed > .1 ? 'walk' : 'idle')), camera.avatarOpacity);
    if (heldWeapon) { // weaponPoses (lane D, critic #7): weapon in hand; arms come up to aim for 1.5 s after each shot
      const weapon = mode === 'on-foot' && !rideSystem?.ride && combat?.started ? combat.weapon : null;
      const aiming = weapon !== null && weapon !== 'fists' && weapon !== 'bat' && (aimHeld || performance.now() - lastShotAt < 1500 || (flags.aimControls && combat?.aimLocked === true)); // RMB / a Z lock holds the aim (lane B)
      aimWeight += ((aiming ? 1 : 0) - aimWeight) * Math.min(1, dt * 12);
      camera.camera.getWorldDirection(aimLook);
      if (aiming) { foot.yaw = Math.atan2(aimLook.x, aimLook.z); player.rotation.y = foot.yaw; } // face the shot
      const swing = flags.meleeSwing && (weapon === 'fists' || weapon === 'bat') ? (performance.now() - lastMeleeAt) / (weapon === 'bat' ? 420 : 260) : -1; // meleeSwing
      heldWeapon.update(weapon, aimWeight, Math.asin(Math.max(-1, Math.min(1, aimLook.y))), swing);
      camera.setAimShoulder(aimWeight); // lane B: over-the-shoulder while aiming (the gun hid behind the body from straight behind)
      // Critic N2/N4: centre CTAs (HOST A STREET RACE) sat under the player's legs in the aim view; fade them while aiming.
      const aimingUi = aimWeight > 0.5; if (aimingUi !== aimingUiShown) { aimingUiShown = aimingUi; document.body.classList.toggle('gt-aiming', aimingUi); }
    }
    // Remote interpolation chooses its distance tier from the current player in wire centimetres.
    localWirePose.x = foot.x * 100; localWirePose.y = foot.y * 100; localWirePose.z = foot.z * 100;
    const radarPeers: RadarPeer[] = [];
    // Radar v2.1: colour top-10 raisers gold on the radar. Build the nick set once per frame.
    const topNicks = new Set<string>();
    for (const leader of latestLeaders) if (leader.rank != null && leader.rank <= 10 && leader.nickname) topNicks.add(leader.nickname);
    const chatPositions: { id: number; x: number; y: number; z: number; name?: string }[] = (chat || nameplates || proximityVoice) ? [{ id: selfId, x: foot.x, y: foot.y, z: foot.z, name: worldNickname ?? 'Founder' }] : [];
    let bountyAt: { x: number; y: number; z: number } | null = null; // the Most Wanted target this frame (bountyClient)
    for (const id of remotes.players.keys()) {
      let avatar = remoteAvatars.get(id);
      if (!avatar && avatarTemplate) {
        const cached = remoteAppearance.get(id);
        const appearance = cached != null ? decodeAppearance(cached) : { ...defaultAppearance(), outfit: id % avatarOutfits.length };
        avatar = avatarTemplate.createInstance(appearance.outfit % avatarOutfits.length, flags.characterLooks ? resolveLook(appearance) : undefined);
        if (flags.meshyTierDress && cached != null) avatar.setTier?.(tierForRound(FUNDING_ROUNDS[appearance.stageRound] ?? FUNDING_ROUNDS[0]!).index);
        scene.add(avatar.root); remoteAvatars.set(id, avatar);
      }
      if (!avatar) continue;
      const p = remotes.sample(id, net?.clock.serverNow() ?? Date.now(), localWirePose);
      if (!p) continue;
      const nick = peerNames.get(id);
      if (bountyClient && id === bountyClient.targetId) bountyAt = { x: p.x / 100, y: p.y / 100, z: p.z / 100 };
      radarPeers.push({ id, x: p.x / 100, z: p.z / 100, role: nick && topNicks.has(nick) ? 'top' : undefined });
      if (chat || nameplates || proximityVoice) chatPositions.push({ id, x: p.x / 100, y: p.y / 100, z: p.z / 100, name: nick });
      const riding = occupants.get(id), vehicle = riding ? fleet.cars.get(riding.vehicleId) : undefined;
      if (flags.carEnterAnim) { // gtasf-9jl2j: other players get in/out with the same cinematic
        const was = remoteSeat.get(id) ?? 0, nowCar = vehicle ? riding!.vehicleId : 0;
        if (was !== nowCar) {
          remoteSeat.set(id, nowCar); remoteSeatAnims.delete(id);
          const car = fleet.cars.get(nowCar || was), carLike = car && car.data.kind !== 'bus' && car.data.kind !== 'cable-car';
          if (carLike && was === 0 && avatar.root.parent === scene && car.model.exit.getWorldPosition(seatDoor).distanceTo(avatar.root.position) < 8)
            remoteSeatAnims.set(id, { kind: 'enter', carId: nowCar, t: 0, from: avatar.root.position.clone() });
          else if (carLike && nowCar === 0) remoteSeatAnims.set(id, { kind: 'exit', carId: was, t: 0, from: new THREE.Vector3() });
        }
      }
      const seatCine = remoteSeatAnims.get(id), seatCar = seatCine ? fleet.cars.get(seatCine.carId) : undefined;
      if (seatCine && seatCar && (seatCine.kind === 'enter') === Boolean(vehicle)) {
        peerImpostors?.release(id); avatar.root.visible = true; avatar.root.matrixWorldAutoUpdate = true;
        const clip = placeSeatAnim(seatCine, avatar.root, seatCar.model, dt, { x: p.x / 100, y: p.y / 100, z: p.z / 100, yaw: p.yaw / 256 * Math.PI * 2 });
        avatar.update(dt, clip ?? (riding?.mode === 'driver' ? 'drive' : 'sit'));
        if (seatCine.done) remoteSeatAnims.delete(id);
      } else if (vehicle) {
        if (avatar.root.parent !== vehicle.model.seat) vehicle.model.seat.add(avatar.root);
        avatar.root.position.set(0, 0, 0); avatar.root.rotation.set(0, 0, 0); avatar.update(dt, riding!.mode === 'driver' ? 'drive' : 'sit');
        avatar.root.matrixWorldAutoUpdate = true;
        remoteRides?.remove(id); // in a car now, not on a personal ride
      } else {
        if (avatar.root.parent !== scene) scene.add(avatar.root);
        avatar.root.position.set(p.x / 100, p.y / 100, p.z / 100); avatar.root.rotation.y = p.yaw / 256 * Math.PI * 2;
        if (shotFeel) { const tilt = shotFeel.flinchTilt(id, performance.now()); if (tilt || avatar.root.rotation.x) { avatar.root.rotation.order = 'YXZ'; avatar.root.rotation.x = tilt; } }
        const clip = p.flags & 0xc0 ? 'sit' : remoteRides && p.flags & RIDING_POSE_FLAG ? fastestUnlockedRide(roundForRemote(id)).id : p.flags & 1 ? 'walk' : 'idle';
        // Far riders also go to silhouettes; their ride is dismounted (hidden) until they come near again.
        const far = peerImpostors && clip !== 'sit'
          && Math.hypot(p.x / 100 - camera.camera.position.x, p.z / 100 - camera.camera.position.z) > peerImpostors.near
          && peerImpostors.place(id, p.x / 100, p.flags & RIDING_POSE_FLAG ? world!.surfaceHeightAt(p.x / 100, p.z / 100, p.y / 100) ?? p.y / 100 : p.y / 100, p.z / 100, avatar.root.rotation.y, clip, dt); // riders' pose y is seat height
        if (far) { avatar.root.visible = false; avatar.root.matrixWorldAutoUpdate = false; }
        else { peerImpostors?.release(id); avatar.root.matrixWorldAutoUpdate = true; avatar.update(dt, clip); } // free the slot while near
        const armed = remoteArmed?.get(id);
        if (armed) { // after the avatar's mixer (the IK overrides the arm pose)
          const since = performance.now() - armed.at;
          if (since > 4000 || far) armed.held?.update(null, 0, 0);
          else {
            if (!armed.held || armed.root !== avatar.root) { armed.held?.dispose(); armed.held = createHeldWeapon(avatar.root); armed.root = avatar.root; }
            const swing = armed.meleeAt === undefined ? -1 : (performance.now() - armed.meleeAt) / (armed.weapon === 'bat' ? 420 : 260);
            armed.held.update(armed.weapon, since < 1500 ? 1 : 0, 0, swing);
          }
        }
        remoteRides?.update(id, decodePose(p), roundForRemote(id), !far && Boolean(p.flags & RIDING_POSE_FLAG));
      }
    }
    peerImpostors?.flush();
    bountyClient?.update(camera.camera, bountyAt);
    // Radar friends layer (d7br option B): poll presence (throttled) + plot each online friend as a
    // role:'friend' pin (username tag + off-screen edge-pin handled by the radar). x/z are world cm.
    if (friendsRadarClient && now - lastFriendPoll > 5000) { lastFriendPoll = now; friendsRadarClient.presence().then(p => { friendPresence = p; }).catch(() => { /* fail-soft: keep last */ }); }
    for (const f of friendPresence) if (f.online && f.x != null && f.z != null) radarPeers.push({ id: `friend:${f.username}`, x: f.x / 100, z: f.z / 100, role: 'friend', name: f.username });
    // SFPD pursuit blips on the minimap (byte-inert until combat+wanted enable). [gtasf-combat-wanted-sfpd]
    if (policeLights) radar?.setPolice([...[...fleet.cars.values()].filter(car => car.data.flags & POLICE_FLAG).map(car => ({ x: car.model.root.position.x, z: car.model.root.position.z })),
      ...(policeOfficers?.positions() ?? [])]); // + SFPD officers on foot (sfpdOnFoot)
    // Siren intensity from the nearest pursuit car: full on top of you, silent past 130 m. [gtasf-combat-ragdoll-audio]
    if (siren) {
      let nearest = Infinity;
      for (const car of fleet.cars.values()) if (car.data.flags & POLICE_FLAG) nearest = Math.min(nearest, Math.hypot(car.model.root.position.x - foot.x, car.model.root.position.z - foot.z));
      siren.setIntensity(nearest < 130 ? 1 - nearest / 130 : 0);
    }
    if (policeBarks) { // policePresence: who's close enough to shout at you
      let officerM = Infinity, cruiserM = Infinity;
      for (const o of policeOfficers?.positions() ?? []) officerM = Math.min(officerM, Math.hypot(o.x - foot.x, o.z - foot.z));
      for (const car of fleet.cars.values()) if (car.data.flags & POLICE_FLAG) cruiserM = Math.min(cruiserM, Math.hypot(car.model.root.position.x - foot.x, car.model.root.position.z - foot.z));
      policeBarks.update(performance.now(), { officerM, cruiserM, inVehicle: mode !== 'on-foot' });
    }
    weaponPickups?.update(foot, now, camera.camera.position); // grab a weapon by walking into its aura [gtasf-combat-gunshop]
    policeOfficers?.update(dt, flags.policePresence ? foot : undefined); // policePresence: standing officers aim at you
    vehicleFx?.update(dt, fleet.cars.values()); // damaged / burning / wrecked cars
    vitalPickups?.update(now, camera.camera.position);
    if (combatPlaces.length && now - lastCombatPlacesSync >= 2000) { lastCombatPlacesSync = now; radar?.setCombatPlaces(isAgeDeclined() ? [] : combatPlaces); }
    carjackEffect?.update(now); // advance any ragdolling ejected drivers [gtasf-combat-carjacking]
    trafficDrivers?.update(fleet.cars.values(), foot, id => (mode !== 'on-foot' && id === vehicleId) || [...occupants.values()].some(o => o.vehicleId === id)); // seat NPC drivers [gtasf-ieoj]
    storeRobberies?.update(foot, now); // linger-to-rob store markers [gtasf-combat-store-robberies]
    radar?.update(foot, foot.yaw, radarPeers, [...fleet.cars.values()].filter(car => car.data.kind === 'robotaxi').map(car => ({ id: car.data.id, x: car.model.root.position.x, z: car.model.root.position.z })), camera.yaw - Math.PI);
    guidance?.update(foot, radar?.route ?? null, mode, !modalOpen, now);
    radar?.setNavigationComplete(guidance?.arrived ?? false);
    emailCapture?.tick();
    if (onboarding) {
      const carPose = mode === 'driver' ? fleet.cars.get(vehicleId)?.model.root.position : undefined;
      tutorial?.update({ mode, x: carPose?.x ?? foot.x, y: carPose?.y ?? foot.y, z: carPose?.z ?? foot.z, speed, running: run,
        riding: rideSystem?.mounted ?? false, scooterAvailable: Boolean(rideSystem), fundingOnline: Boolean(funding && connected), now });
      tutorialBeacon?.setTarget(onboarding.state.completed ? null : tutorialTarget(onboarding.state.step));
      tutorialBeacon?.update(camera.camera, foot, now);
      // Nearby drops announce themselves in the contextual banner. Do not replace a
      // hidden distant banner with an equally distant onboarding announcement.
      const hintCar = mode === 'on-foot' ? fleet.nearest(foot) : undefined;
      const hintAngel = mode === 'on-foot' ? angels?.nearest(foot) : undefined;
      const canPitch = Boolean(hintAngel && !hintAngel.alreadyPitched);
      const showInteractionHints = !flags.contextualInteractionHints || !modalOpen;
      onboarding.tickHints({
        // Fresh angel pitches own E before vehicles. Already-pitched angels must not hide the
        // actionable car prompt with a first-time "pitch" chip (chips suppress the footer hint).
        nearCar: showInteractionHints && Boolean(hintCar) && (!flags.contextualInteractionHints || !canPitch),
        nearAngel: showInteractionHints && (flags.contextualInteractionHints ? canPitch : Boolean(hintAngel)),
        nearPlayer: showInteractionHints && (!flags.contextualInteractionHints || (!canPitch && !hintCar))
          && chatPositions.some(p => p.id !== selfId && Math.hypot(p.x - foot.x, p.z - foot.z) < 12),
        firstDrop: !flags.hud && Boolean(drops && dropRadarBlips(drops).length), firstRumour: Boolean(angels?.activeRumourZone(now)),
        firstRound: onboardingFirstRound, firstFriendRequest: false, // TODO(pane 13): friend-request event hook
        idleMs: now - lastInputMs, isTouch: input?.touch.visible ?? false });
      onboardingFirstRound = false;
    }
    if (funding) {
      funding.update(foot, mode, connected); fundingRoom?.update(funding);
    }
    if (drops) {
      drops.update(foot, mode, connected, now);
      if (!flags.hud || (drops.nearest?.distance ?? Infinity) < 300) dropBanner?.update(drops, Date.now());
      else if (dropBanner && !dropBanner.element.hidden) dropBanner.element.hidden = true;
      dropCheckpoint?.update(drops, now, camera.camera.position); radar?.setDrops(dropRadarBlips(drops));
    }
    if (funding) {
      fundingPerks?.update(foot, mode, vehicleId, dt, connected);
      if (funding.inside && guidance) guidance.element.hidden = true;
    }
    upcoming?.update(foot);
    chat?.setEvent(funding?.inside && funding.target ? { id: funding.target.eventId, title: funding.target.title } : null);
    chat?.update(camera.camera, selfId, chatPositions, now);
    if (flags.hudMenuFold) { // critic R5: the touch 🎙 shows only with someone in earshot (pauseMenu.css)
      const near = chatPositions.some(p => p.id !== selfId && Math.hypot(p.x - foot.x, p.z - foot.z) < 40);
      if (near !== document.body.hasAttribute('data-voice-near')) document.body.toggleAttribute('data-voice-near', near);
    }
    // One-time spoken-bubble hint the first time another player is within 40 m (only if captions are available here).
    // Not during onboarding (1.2 review): at the busy Ferry it fired ~1 s after spawn, over the paint step.
    if (spokenCaptions && !spokenHintShown && now >= spokenHintCheckAt && (!onboarding || onboarding.state.completed)) {
      spokenHintCheckAt = now + 1000;
      if (!hasModal() && chatPositions.some(p => p.id !== selfId && Math.hypot(p.x - foot.x, p.z - foot.z) < 40)) {
        spokenHintShown = true;
        try { localStorage.setItem('gtasf:spoken-hint', '1'); } catch { /* private mode: shown once this session */ }
        toasts.notice(matchMedia('(pointer: coarse)').matches
          ? '🎙 Hold the mic button to talk: your words appear above your head' : '🎙 Hold V to talk: your words appear above your head', 6000);
      }
    }
    proximityVoice?.update({ x: foot.x, y: foot.y, z: foot.z, yaw: camera.yaw }, chatPositions, now);
    // Own plate hides while the district banner shows (it sits in the same lower-centre band on phones, e.g. at spawn).
    nameplates?.update(camera.camera, selfId, chatPositions, now, (camera.avatarOpacity ?? 1) > 0.35 && !(streetHud && !streetHud.element.hidden));
    net?.clock.observe();
    if (now - lastSend >= 100) {
      if (mode === 'driver' && driving) net?.send({ type: 'VEHICLE_MOVE', vehicleId, seq: vehicleSeq = (vehicleSeq + 1) & 65535, ...encodePose(driving) });
      else if (mode === 'on-foot') net?.move(encodePose(foot, (speed > .1 ? 1 : 0) | (rideSystem?.mounted ? RIDING_POSE_FLAG : 0)));
      lastSend = now;
    }
    setStatusText(population, `${remotes.players.size + 1} ${remotes.players.size ? 'players' : 'player'}`);
    const nearbyVehicle = mode === 'on-foot' ? fleet.nearest(foot) : undefined;
    const nearbyAngel = mode === 'on-foot' ? angels?.nearest(foot) : undefined;
    const interactionKey = input?.touch.visible ? 'Tap Enter / exit' : 'E';
    const nearbyMeme = mode === 'on-foot' ? founderMemeNpcs?.nearest(foot) : undefined;
    // The verb matches the quest, not always "Pitch": a share NPC offers to be heard, a drive NPC a cone to
    // escape. Lower-case the archetype's leading article so "A thought leader" reads "a thought leader".
    const memePrompt = nearbyMeme ? (() => {
      const spec = nearbyMeme.spec, a = spec.archetype.charAt(0).toLowerCase() + spec.archetype.slice(1);
      if (spec.questKind === 'share') return `${interactionKey} · Hear ${a}'s take`;
      if (spec.questKind === 'drive') return `${interactionKey} · ${driveCopyOf(spec).prompt}`;
      return `${interactionKey} · Pitch ${spec.archetype}`;
    })() : null;
    // Phase 6: the Demo Day MC prompts only when the round quest is open (held Seed + cooldown elapsed), so a
    // player who hasn't closed Seed isn't teased with a pitch they can't take (the E-handler explains either way).
    const nearbyDemoDay = mode === 'on-foot' ? founderDemoDay?.nearest(foot) : undefined;
    const demoDayPrompt = nearbyDemoDay && seriesAQuestReady(currentRound?.id ?? 'bootstrapping', loadFounderSession().lastRoundCloseDay, fundingDay(Date.now()))
      ? `${interactionKey} · Pitch on the Demo Day stage` : null;
    // Phase 6 surfacing (gtasf-8c8wo): 8 real players hold Seed+ yet nobody ever pitched Demo Day — nothing told a returning
    // Seed player it was open or where. Once per session, when the quest opens, put it on the quest card with a route.
    if (flags.seriesAQuest && !seriesAOffered && currentRound?.id === 'seed' && founderLadderFlow?.active
      && seriesAQuestReady('seed', loadFounderSession().lastRoundCloseDay, fundingDay(Date.now()))) {
      seriesAOffered = founderLadderFlow.offerSeriesA(() => {
        const p = projectLocation(FOUNDER_SERIES_A_PLACE.lat, FOUNDER_SERIES_A_PLACE.lon, world!.manifest.frame);
        const dest: RadarDestination = { id: 'series-a-demo-day', title: 'Demo Day', x: p.x, y: world!.surfaceHeightAt(p.x, p.z) ?? foot.y, z: p.z, walkingStop: true };
        routeDestination(dest);
      });
    }
    const angelPrompt = nearbyAngel ? nearbyAngel.alreadyPitched
      ? `${celebLabel(nearbyAngel.npc)} — already pitched`
      : `${interactionKey} · Pitch ${celebLabel(nearbyAngel.npc)}` : null;
    const vehiclePrompt = nearbyVehicle ? `${interactionKey} · ${vehicleEntryMode(nearbyVehicle.data) === 'passenger'
      ? nearbyVehicle.data.kind === 'cable-car' ? 'Board cable car' : nearbyVehicle.data.kind === 'bus' ? 'Board bus' : 'Ride robotaxi'
      : nearbyVehicle.data.flags & 0x20 ? 'Take over and drive' : 'Get in and drive'}` : null;
    // gtasf-0lnjq: a kerb-parked prop within reach can be stolen when no real car is nearer.
    const kerbPrompt = !vehiclePrompt && mode === 'on-foot' && flags.kerbCarTheft && nearestKerbCar(foot.x, foot.z, KERB_STEAL_M) ? `${interactionKey} · Steal this car` : null;
    // Match enterExit: a fresh angel takes E; an already-pitched angel yields to the car.
    const pitchPrompt = mode === 'on-foot' && preSeedPitchWins() ? `${interactionKey} · Pitch the partner at Pear VC` : null; // matches enterExit
    const interactionPrompt = nearbyAngel && !nearbyAngel.alreadyPitched ? angelPrompt : memePrompt ?? demoDayPrompt ?? pitchPrompt ?? vehiclePrompt ?? kerbPrompt ?? angelPrompt;
    // Personal-ride hint (gtasf-v21-ride-hud-hint); empty unless flags.personalRides (rideSystem is null).
    const rideHint = rideSystem && mode === 'on-foot' && currentRound
      ? (rideSystem.mounted ? ' · G hop off' : ` · G ride your ${rideSystem.availableLabel(currentRound).toLowerCase()}`)
      : '';
    if (rideButton) { // tappable ride control: shown only on foot when rides are unlocked (mobile reachability)
      const showRide = Boolean(rideSystem) && mode === 'on-foot';
      rideButton.hidden = !showRide;
      if (showRide) rideButton.textContent = rideSystem!.mounted ? 'Hop off · G' : 'Ride · G';
    }
    if (mayhemFireButton && mayhemItemButton) { // tappable mayhem controls (mobile), on foot when enabled
      const showMayhem = Boolean(mayhem) && mode === 'on-foot';
      mayhemFireButton.hidden = mayhemItemButton.hidden = !showMayhem;
      if (showMayhem) mayhemItemButton.textContent = `${MAYHEM_ITEMS.find(i => i.id === mayhem!.selected)?.label ?? 'Item'} · X`;
    }
    setStatusText(prompt, interactionPrompt ?? (mode === 'driver' ? 'WASD drive · Space handbrake · E exit' : mode === 'passenger' ? occupied?.data.kind === 'cable-car' ? 'Cable car ride · E get off' : 'Autonomous ride · E exit' : 'WASD walk · Shift run · H hail a robotaxi' + rideHint));
    if (flags.hud) {
      prompt.hidden = modalOpen || !interactionPrompt;
    }
    pauseMenu?.update(!modalOpen && !document.body.hasAttribute('data-onb-locked') && !document.querySelector('dialog[open]'), mode, input?.touch.visible ?? false, rideSystem?.mounted ?? false);
    const noticeActive = performance.now() <= noticeUntil;
    const waitingAtCurb = taxi.state === 'pickup' && taxi.etaSeconds === 0 && mode === 'on-foot';
    setStatusData(statusLine, 'notice', String(noticeActive || waitingAtCurb));
    if (!noticeActive && !waitingAtCurb) setStatusText(statusLine, `Destination: ${selectedDestination.title}`);
    setStatusText(hailButton, taxi.buttonLabel);
    if (waitingAtCurb) {
      const pickup = fleet.cars.get(taxi.vehicleId);
      const distance = pickup ? Math.ceil(Math.hypot(pickup.model.root.position.x - foot.x, pickup.model.root.position.z - foot.z)) : 0;
      setStatusText(statusLine, `Your white robotaxi is waiting at the curb${distance ? ` · ${distance} m` : ''}. Walk toward it to board.`);
    }
    setStatusData(canvas, 'ready', 'true'); setStatusData(canvas, 'players', String(remotes.players.size + 1));
    setStatusData(canvas, 'mode', mode); setStatusData(canvas, 'vehicleId', String(vehicleId)); setStatusData(canvas, 'taxiState', taxi.state);
    setStatusData(canvas, 'x', foot.x.toFixed(3)); setStatusData(canvas, 'y', foot.y.toFixed(3)); setStatusData(canvas, 'z', foot.z.toFixed(3));
    setStatusData(canvas, 'speed', speed.toFixed(2)); setStatusData(canvas, 'chunks', String(world!.stats.mounted));
    setStatusData(canvas, 'vehicles', String(fleet.cars.size)); setStatusData(canvas, 'connected', String(connected));
    setStatusData(canvas, 'events', String(radar?.eventCount ?? 0));
  }
  // Look-check stills (testing harness only): ?aerial=lat,lon,heightAboveGroundM,lookLat,lookLon parks the render camera at a
  // fixed aerial pose, e.g. over Nob Hill looking at FiDi (gtasf-r9f6 before/after shots). Never in normal play.
  const aerialPose = (() => {
    if (!flags.testingHarness) return undefined;
    const v = params.get('aerial')?.split(',').map(Number);
    if (!v || v.length !== 5 || !v.every(Number.isFinite)) return undefined;
    const at = projectLocation(v[0]!, v[1]!, world.manifest.frame), look = projectLocation(v[3]!, v[4]!, world.manifest.frame);
    const groundAt = world.surfaceHeightAt(look.x, look.z) ?? 0;
    // heightM is ABOVE the ground under the camera (absolute y put the camera inside hills, e.g. the Haight).
    const groundCam = world.surfaceHeightAt(at.x, at.z) ?? groundAt;
    return { x: at.x, y: groundCam + v[2]!, z: at.z, lx: look.x, ly: groundAt + 10, lz: look.z };
  })();
  function render() {
    if (aerialPose) {
      camera.camera.position.set(aerialPose.x, aerialPose.y, aerialPose.z); camera.camera.lookAt(aerialPose.lx, aerialPose.ly, aerialPose.lz);
      camera.camera.updateMatrixWorld();
    }
    if (cameraSafe) {
      googleTiles?.update(camera.camera, foot, performance.now());
      // Car-crash shake (gtasf-4g29): a brief decaying jitter of the camera position for this draw only.
      shotFeel?.update(performance.now());
      const recoil = reducedMotionShake ? 0 : shotFeel?.recoilPitch(performance.now()) ?? 0; // shootingFeel: kick the view up
      if (recoil) camera.camera.rotateX(recoil);
      const shakeLeft = cameraShakeUntil - performance.now();
      if (shakeLeft > 0 && cameraShake > 0 && !reducedMotionShake) {
        const k = cameraShake * Math.min(1, shakeLeft / 200), p = camera.camera.position;
        const ox = (Math.random() - .5) * k, oy = (Math.random() - .5) * k * .6, oz = (Math.random() - .5) * k;
        p.x += ox; p.y += oy; p.z += oz; foundation.render(camera.camera, true, undefined, foot.y); p.x -= ox; p.y -= oy; p.z -= oz; camera.camera.updateMatrixWorld(); // as the recoil restore below
      } else foundation.render(camera.camera, true, undefined, foot.y);
      // gtasf-kd2rv: the render refreshed matrixWorld WITH the kick; restore it too, or every reader until the next draw
      // (aim raycast, label projection) sees last frame's recoil.
      if (recoil) { camera.camera.rotateX(-recoil); camera.camera.updateMatrixWorld(); }
    }
    // Resolve a pending K-key feedback screenshot from the live frame. The renderer has no
    // preserveDrawingBuffer, so toDataURL must run synchronously right after the draw.
    if (pendingCapture) { const resolve = pendingCapture; pendingCapture = null; let url: string | null = null; try { url = canvas.toDataURL('image/jpeg', 0.7); } catch { url = null; } resolve(url); }
    if (!cardHidden) hideLoadingCard(); // cardOnFirstTick: the first frame is drawn (and its programs compiled)
  }
  const loadStreetWalkers = () => createStreetWalkers({ template: avatarTemplate, graph: world.graph, ground: surface, position: foot,
    roadHeightAt: world.roadHeightAt, isLoaded: (x, z) => world.heightAt(x, z) !== null, low: foundation.tier === 'low', frame: world.manifest.frame,
  }).catch(error => { console.warn('Street walkers could not load.', error); return null; });
  // Walkers index every city sidewalk once; on the spawn-area graph, wait for the full one. [gtasf-0k01]
  // gtasf-we8bl: NEVER awaited during boot. Their crowd assets wait for READY (afterReady in crowdVat/peopleAssets), and
  // READY is the end of this boot, so awaiting them here deadlocked whenever the full graph was already in at spawn
  // (Tenderloin deep links sat on 'Finding other founders…' forever). They fill in just after READY, as they already did
  // on spawn-area-graph spawns.
  void (world.graphComplete ? Promise.resolve() : fullGraph.catch(() => {})).then(loadStreetWalkers).then(walkers => {
    if (appDisposed) { walkers?.dispose(); return; }
    streetWalkers = walkers; if (walkers) scene.add(walkers.root);
  });
  update(0, 0); // Both city and plaza populations are already placed before the first world render.
  // Optional Meshy props (flags.parkedProps): ~2 MB on HD, so they start well after READY (gtasf-8s12: loading them in
  // the boot window stalled the Ferry spawn at 'Still connecting'); keep their authored materials intact.
  if (flags.parkedProps) setTimeout(() => { if (appDisposed) return; void createParkedVehicles({ landmarks, low: foundation.tier === 'low',
    heightAt: visualGround.heightAt, isLoaded: (x, z) => world.heightAt(x, z) !== null,
  }).then(result => {
    if (!result) return;
    if (appDisposed) { result.dispose(); return; }
    result.update(foot, performance.now());
    scene.add(result.root);
    parkedVehicles = result;
  }).catch(error => { if (!appDisposed) console.warn('Parked vehicles could not load.', error); }); }, 6000);
  if (sceneCompile) await Promise.race([sceneCompile, new Promise(resolve => window.setTimeout(resolve, 1500))]); // never hold the loop long
  performance.mark('gtasf:loop-setup-done'); // cold-load trace: city-connected -> here = main-thread setup before the first tick
  if (qaPrograms) (window as unknown as { __gtasfPrograms?: { before: string[]; after?: string[]; now?: () => string[] } }).__gtasfPrograms = { before: programNames(), now: programNames }; // now(): poll the list after READY
  if (harness) harness.run({ input, world: { foot, feet, camera, map: world, fleet, radar, guidance, upcoming, taxi, outbid, outbidCrown, landmarks, get streetProps() { return streetProps; }, get parodyBillboards() { return parodyBillboards; }, get roadDetails() { return roadDetails; }, get streetWalkers() { return streetWalkers; }, get policeOfficers() { return policeOfficers; }, get missionPresentation() { return missionPresentation; }, get founderPlazaInvestor() { return founderPlazaInvestor; }, ferryPedestrians, coffeeQueue, doloresWeekend, angels, funding, fundingRoom, fundingHud, fundingPerks, referralPanel, vehicleAudio: { get state() { return vehicleAudio?.state; } }, get mode() { return mode; }, get vehicleId() { return vehicleId; }, get player() { return player; }, get remoteAvatars() { return remoteAvatars; }, get taxiState() { return taxi.state; }, get driving() { return driving; }, carContactStats, kerbCarBodies }, update, render }, scenarios);
  else renderer.setAnimationLoop(now => { const dt = Math.min(.1, Math.max(0, (now - previous) / 1000)); previous = now; update(dt, now); render(); });
  // Let READY paint first, then build city scenery (non-harness play only; harness awaited it above).
  if (!scriptedRun) setTimeout(() => { void loadScenery().catch(error => console.warn('Scenery could not load.', error)); }, 400);
  addEventListener('pagehide', () => {
    appDisposed = true; parkedVehicles?.dispose(); streetWalkers?.dispose();
    angelPitch?.dispose();
    emailCapture?.destroy(); closeEmailDialogs(); offEmailDialog();
    renderer.setAnimationLoop(null); harness?.dispose(); input?.dispose(); keyboard?.dispose(); pointer?.dispose(); actions.dispose(); net?.dispose();
    pauseMenu?.destroy(); releasePauseCursor?.(); phoneHud?.destroy();
    wardrobe?.dispose(); releaseWardrobeCursor?.();
    closeRecoveryDialogs(); offRecoveryDialog(); releaseCapTableCursor?.(); releaseAdSlotCursor?.();
    linkedDestination.cancel();
    googleTiles?.dispose(); removeLoadingArt(); eventFeed?.destroy();
    collectedEvents?.destroy(); funding?.destroy(); fundingRoom?.destroy(); fundingHud?.destroy(); releaseFundingCursor?.();
    drops?.destroy(); dropBanner?.destroy(); dropCheckpoint?.destroy();
    fundingPerks?.destroy(); releasePerksCursor?.(); unmountStreetProps?.(); streetProps?.destroy(); unmountPlazaFurniture?.(); plazaFurniture?.dispose(); unmountCityLife?.(); cityLife?.dispose();
    ferryPedestrians?.dispose(); coffeeQueue?.dispose(); doloresWeekend?.dispose(); angels?.dispose();
    taxiPicker?.destroy(); quickRide?.destroy();
    voiceUi?.destroy(); proximityVoice?.destroy();
    referralPanel?.destroy(); releaseReferralCursor?.(); trafficControls?.destroy(); radio?.destroy(); vehicleAudio?.destroy(); sfx?.destroy(); gameOptions?.destroy(); releaseOptionsCursor?.(); chat?.destroy(); releaseChatCursor?.(); whatsNew?.destroy(); nameplates?.destroy(); capTable?.destroy(); rideSystem?.destroy(); becomeAnAngel?.destroy(); friendsPanel?.destroy(); releaseFriendsCursor?.(); identityScreen?.destroy(); founderCrown?.destroy(); document.body.classList.remove('gt-founder-ladder'); adSlotMarkers?.destroy(); adSlotPage?.destroy(); toasts.dispose(); eventSubmit?.destroy(); feedback?.destroy();
    unmountParodyBillboards?.(); parodyBillboards?.destroy(); roadDetails?.dispose(); unmountSkyAds?.(); skyAds?.destroy();
    worldEventLinks?.destroy();
    releaseMapCursor?.(); releaseEventCursor?.(); outbid?.destroy(); releaseOutbidCursor?.(); outbidCrown.destroy(); upcoming?.destroy(); guidance?.destroy(); radar?.destroy(); markers?.destroy(); hud?.destroy(); streetHud?.destroy(); creatorLinks?.destroy(); unmountLandmarks(); disposeLandmark(landmarks);
    clearRemotes(); fleet.dispose(); avatarTemplate?.dispose(); world.dispose(); foundation.dispose(); removeEventListener('resize', resize);
  }, { once: true });
}
