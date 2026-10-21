import type { Feature } from '@gtasf/shared/flags';

/**
 * Original GTASF copy with an arcade crime-game cadence, no borrowed dialogue.
 * Text is presentation data, never proof of an event visit or a gameplay reward.
 * Consumers must check the existing switches below at their entry points. Enable
 * after the owning beads verify validated visits, toast UX, hazards and city LODs.
 * gtasf-32c owns stars/city life; gtasf-ts8 hazards; gtasf-lcj arrival feedback.
 */
export const FLAVOUR_FEATURE_FLAGS = {
  missions: ['hud', 'eventVisits'],
  funded: ['hud', 'fundedStars', 'eventVisits'],
  runway: ['hud', 'hazards'],
  hazards: ['hazards'],
  chatter: ['cityLife'],
} as const satisfies Record<string, readonly Feature[]>;

export const MISSION_PASSED = 'MISSION PASSED';
export const RUNWAY_ENDED = 'RUNWAY ENDED';
export const FUNDED_LABEL = 'FUNDED';
export const UNFUNDED_COPY = 'BOOTSTRAPPING — your first verified event visit earns a star.';

export interface FundedTier {
  readonly id: string;
  readonly name: string;
  readonly stars: 1 | 2 | 3 | 4 | 5 | 6;
  /** Proposed tuning: distinct, server-validated event visits, never client ticks. */
  readonly minValidatedVisits: number;
  readonly toast: string;
}

export const FUNDED_TIERS = [
  { id: 'seed', name: 'Seed', stars: 1, minValidatedVisits: 1, toast: 'One introduction. Infinite projections.' },
  { id: 'series-a', name: 'Series A', stars: 2, minValidatedVisits: 3, toast: 'Your pitch now has a second slide.' },
  { id: 'series-b', name: 'Series B', stars: 3, minValidatedVisits: 6, toast: 'You can expense the fancy sparkling water.' },
  { id: 'series-c', name: 'Series C', stars: 4, minValidatedVisits: 10, toast: 'The vest has acquired a vest.' },
  { id: 'growth', name: 'Growth', stars: 5, minValidatedVisits: 15, toast: 'Your calendar has hired an assistant.' },
  { id: 'unicorn', name: 'Unicorn', stars: 6, minValidatedVisits: 21, toast: 'A billion imaginary dollars. Still nowhere to park.' },
] as const satisfies readonly FundedTier[];

export interface MissionCopy {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly passed: string;
  readonly context: 'event' | 'travel' | 'exploration';
}

/** Copy options for real gameplay triggers; this catalog does not add quest logic. */
export const MISSION_TEXT = [
  { id: 'warm-intro', title: 'WARM INTRODUCTION', objective: 'Reach the event marker. Practice saying your name without your job title.', passed: 'Contact acquired. Follow-up email already overdue.', context: 'event' },
  { id: 'demo-day', title: 'DEMO OR DIE TRYING', objective: 'Get to the demo before the laptop updates.', passed: 'Demo delivered. Nobody saw the terminal.', context: 'event' },
  { id: 'rooftop-round', title: 'ABOVE THE CAP TABLE', objective: 'Find the rooftop event. Take the elevator, not the valuation.', passed: 'You reached the top. The drinks are still tiny.', context: 'event' },
  { id: 'coffee-meeting', title: 'LIQUID RUNWAY', objective: 'Make the coffee meetup before it becomes an asynchronous thread.', passed: 'Caffeine secured. Action items remain unclaimed.', context: 'event' },
  { id: 'pitch-night', title: 'DECK CHECK', objective: 'Arrive at pitch night with your optimism intact.', passed: 'Pitch heard. The room has requested fewer acronyms.', context: 'event' },
  { id: 'afterparty', title: 'AFTER THE AFTERPARTY', objective: 'Find the next event while your social battery still has a bar.', passed: 'You made it. Your name tag has made it twice.', context: 'event' },
  { id: 'founder-breakfast', title: 'EGGS AND EXITS', objective: 'Reach the breakfast meetup before somebody disrupts the buffet.', passed: 'Breakfast complete. The croissant had great margins.', context: 'event' },
  { id: 'build-night', title: 'SHIP HAPPENS', objective: 'Get to build night. Bring an idea smaller than a platform.', passed: 'Something shipped. The group chat is investigating.', context: 'event' },
  { id: 'community-meetup', title: 'PEOPLE, ACTUALLY', objective: 'Find the meetup. Ask someone a question with no sales funnel.', passed: 'Conversation unlocked. No deck required.', context: 'event' },
  { id: 'panel-time', title: 'THOUGHT LEADERS, FOLLOW ME', objective: 'Arrive before the panel starts defining the future.', passed: 'Future discussed. Present still needs chairs.', context: 'event' },
  { id: 'lombard-descent', title: 'EIGHT TURNS TO GLORY', objective: 'Ride down Lombard. Keep the breakfast where you left it.', passed: 'Switchbacks survived. Your roadmap looks straighter already.', context: 'travel' },
  { id: 'robotaxi-ride', title: 'NO HANDS ON DECK', objective: 'Hail a robotaxi and let it handle the route.', passed: 'Arrived without giving the lidar career advice.', context: 'travel' },
  { id: 'cable-car', title: 'TERM SHEET ON A WIRE', objective: 'Ride the cable car. Keep your elbows and ambitions inside.', passed: 'Bell rung. Hill negotiated.', context: 'travel' },
  { id: 'muni-ride', title: 'PUBLICLY TRANSPORTED', objective: 'Catch your Muni ride and make room for the next passenger.', passed: 'You moved collectively. Nobody needed a pivot.', context: 'travel' },
  { id: 'park-the-car', title: 'PARKING-MARKET FIT', objective: 'Find a place to stop without becoming the traffic.', passed: 'Space secured. A rare local liquidity event.', context: 'travel' },
  { id: 'pier-39', title: 'BOARD OF SEA LIONS', objective: 'Visit Pier 39 and hear the loudest panel in town.', passed: 'The board has barked. Motion carries.', context: 'exploration' },
  { id: 'dolores', title: 'BLANKET ROUND', objective: 'Reach Dolores Park. Find a patch of grass with room for a dream.', passed: 'Blanket deployed. Productivity respectfully declined.', context: 'exploration' },
  { id: 'painted-ladies', title: 'CURB APPEAL', objective: 'Visit the Painted Ladies. Admire a design that survived several frameworks.', passed: 'Architecture appreciated. No redesign requested.', context: 'exploration' },
  { id: 'coit', title: 'VERTICAL INTEGRATION', objective: 'Head toward Coit Tower and let the skyline do the talking.', passed: 'Perspective gained. Deck font size unchanged.', context: 'exploration' },
  { id: 'ferry-building', title: 'FERRY GOOD CONNECTIONS', objective: 'Reach the waterfront. Give your notifications a sea breeze.', passed: 'Waterfront reached. Inbox still landlocked.', context: 'exploration' },
] as const satisfies readonly MissionCopy[];

export const RUNWAY_ENDINGS = [
  { id: 'collision', reason: 'Your bumper met a hard constraint.', retry: 'Return to the road. The pitch can wait.' },
  { id: 'hill', reason: 'Gravity declined your counteroffer.', retry: 'Respawn on the road and try a slower descent.' },
  { id: 'water', reason: 'Your company is liquid. Your car should not be.', retry: 'Return to dry land.' },
  { id: 'cone', reason: 'A cone has been appointed interim CEO.', retry: 'Reset to the road and leave the cone to its duties.' },
  { id: 'meter', reason: 'The parking meter completed a hostile acquisition.', retry: 'Take a breath. Find another space.' },
  { id: 'burnout', reason: 'You attended every mixer except the one called sleep.', retry: 'Start fresh. One event at a time.' },
  { id: 'stuck', reason: 'Your route has entered an extended board meeting.', retry: 'Respawn on the road to get moving again.' },
  { id: 'generic', reason: 'The runway was shorter than the slide suggested.', retry: 'Back to the street. There is another way through.' },
] as const;

export interface HazardCopy {
  readonly id: string;
  readonly title: string;
  readonly warning: string;
  readonly detail: string;
  readonly advice: string;
}

/** Fictional notices for game hazards, not real transit alerts or parking rates. */
export const SF_HAZARDS = [
  { id: 'coned-robotaxi', title: 'CONE OF SILENCE', warning: 'Robotaxi reconsidering its entire career.', detail: 'One traffic cone. Several million lines of uncertainty.', advice: 'Give the stopped car room and go around slowly.' },
  { id: 'late-muni', title: 'MUNI: EVENTUALLY', warning: 'Arrival estimate currently exploring other opportunities.', detail: 'The bus is three minutes away in a very flexible sense.', advice: 'Check your route or walk to the next stop.' },
  { id: 'parking-meter', title: 'FOURTEEN DOLLAR FEELINGS', warning: '$14 parking. Your car now has a burn rate.', detail: 'This fictional meter accepts coins, cards, and your last shred of optimism.', advice: 'Keep the lane clear while you find a space.' },
  { id: 'delivery-robot', title: 'SOUP HAS RIGHT OF WAY', warning: 'Tiny robot. Large lunch responsibility.', detail: 'It has six wheels and one very urgent dumpling.', advice: 'Slow down and leave the sidewalk clear.' },
  { id: 'crypto-billboard', title: 'PROOF OF BILLBOARD', warning: 'A token has purchased a very large opinion.', detail: 'The chart only goes up because the printer ran out of red.', advice: 'Keep your eyes on the road.' },
  { id: 'fog-bank', title: 'KARL HAS ENTERED THE CHAT', warning: 'Visibility is now invite-only.', detail: 'The skyline has switched to stealth mode.', advice: 'Slow down until the road is clear.' },
  { id: 'steep-hill', title: 'SERIES G: GRAVITY', warning: 'The next block has a strong downhill thesis.', detail: 'Your brakes would like a seat on the board.', advice: 'Brake before the descent and leave space ahead.' },
  { id: 'cable-car', title: 'BELL BEFORE THE STORM', warning: 'Cable car approaching. It has seniority.', detail: 'A century of product-market fit, delivered one ding at a time.', advice: 'Keep clear of the tracks and boarding passengers.' },
  { id: 'coffee-queue', title: 'QUEUE ROUND', warning: 'Coffee line extending into next quarter.', detail: 'The queue has a community manager and no known end.', advice: 'Leave room for people passing on the sidewalk.' },
  { id: 'dolores-crowd', title: 'PARK AT CAPACITY', warning: 'Blanket density approaching critical picnic.', detail: 'Every friend is next to a different palm tree.', advice: 'Slow down near the park and watch for people crossing.' },
] as const satisfies readonly HazardCopy[];

export interface NpcChatterGroup {
  readonly id: string;
  readonly persona: string;
  readonly lines: readonly string[];
}

/** Ambient subtitles; fictional people. Do not inject these into real player chat. */
export const NPC_CHATTER = [
  { id: 'vest-founder', persona: 'Founder in a vest', lines: [
    'We are pre-everything. Very early. Even for coffee.',
    'The vest is reversible. So is the business model.',
    'Can I pitch you while this light is red?',
    'My cofounder is a spreadsheet with strong opinions.',
    'I moved here for the network. The Wi-Fi is actually pretty bad.',
    'Our office has a slide. It is slide seven of the deck.',
  ] },
  { id: 'coffee-regular', persona: 'Coffee queue regular', lines: [
    'I joined this line as a junior engineer.',
    'They know my order. They do not know my actual name.',
    'The tasting notes say rent, citrus, and regret.',
    'No, the smaller cup is the more expensive one.',
    'My coffee has a passport. I have not left the neighborhood.',
    'I said a little foam, not a cloud migration.',
  ] },
  { id: 'commuter', persona: 'Seasoned commuter', lines: [
    'The bus is coming. I am not taking further questions.',
    'I know a shortcut. It has three extra hills.',
    'Every jacket I own is on me right now.',
    'The train doors are not a place to discover your pockets.',
    'I can identify my stop by the squeak.',
    'My transfer is an act of faith with a timetable.',
  ] },
  { id: 'dog-walker', persona: 'Neighborhood dog walker', lines: [
    'He is friendly. He just hates rolling suitcases.',
    'The dog has more cafe loyalty points than I do.',
    'We are going to the park by way of every single tree.',
    'That robot has snacks. He can tell.',
    'His raincoat has better pockets than mine.',
    'He networked with three terriers before breakfast.',
  ] },
  { id: 'park-friend', persona: 'Dolores Park friend', lines: [
    'We are by the palm tree. No, the other palm tree.',
    'This blanket seats four people or twelve optimists.',
    'Who brought the speaker and forgot the music?',
    'I packed for summer. That was an hour ago.',
    'The picnic has reached burrito consensus.',
    'Can we have one afternoon without naming a group chat?',
  ] },
  { id: 'pier-visitor', persona: 'Pier 39 visitor', lines: [
    'That sea lion has my exact meeting voice.',
    'The loud one is clearly chairing the committee.',
    'I took forty photos. They are all the same sea lion.',
    'The seagull has been watching my fries for ten minutes.',
    'We came for the view and stayed because nobody can find the car.',
    'The boat tour brochure did not mention this much wind.',
  ] },
  { id: 'local-artist', persona: 'Local artist', lines: [
    'The mural is finished. The artist statement is still compiling.',
    'That fog is doing wonders for my unfinished background.',
    'I traded a print for a bike repair. Best deal all week.',
    'The gallery is also a laundry room. Opening hours are complicated.',
    'I liked that building before it became a mood board.',
    'Please do not call my sketchbook a content pipeline.',
  ] },
  { id: 'event-volunteer', persona: 'Event volunteer', lines: [
    'Name tags on the left. Existential questions after the panel.',
    'The Wi-Fi password is on the slide nobody photographed.',
    'Yes, this is the event. No, the other event is upstairs.',
    'We have vegan options and noncommittal networking options.',
    'Please take one tote bag. They cannot all be your cofounder.',
    'The speaker is running late. We have promoted the snacks.',
  ] },
] as const satisfies readonly NpcChatterGroup[];
