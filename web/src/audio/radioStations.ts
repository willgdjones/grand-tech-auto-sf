/** Original GTASF station catalog. Audio is assigned only at playback, never preloaded. */
export interface RadioClip { readonly title: string; readonly file: string; readonly kind: 'music' | 'talk' | 'dj' | 'ad'; readonly text?: string }
export interface GenreStation { readonly id: string; readonly name: string; readonly host: string; readonly genre: string; readonly tagline: string; readonly tracks: readonly RadioClip[]; readonly dj: readonly RadioClip[] }
/** Shuffle bags play every item before recycling, without a repeat across bag boundaries. */
function bag<T>(items: readonly T[], random: () => number) {
  let remaining: T[] = [], previous: T | undefined;
  return () => {
    if (!remaining.length) {
      remaining = [...items];
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j]!, remaining[i]!];
      }
      if (remaining.length > 1 && remaining.at(-1) === previous) {
        [remaining[0], remaining[remaining.length - 1]] = [remaining.at(-1)!, remaining[0]!];
      }
    }
    previous = remaining.pop();
    return previous!;
  };
}

/** Two songs (or talk segments), then one break. DJ and fictional ad breaks alternate. */
export function createStationSchedule(station: GenreStation, random = Math.random) {
  const track = bag(station.tracks, random), dj = bag(station.dj, random), ad = bag(RADIO_ADS, random);
  let songs = 0, advertising = false;
  return (): RadioClip => {
    if (songs < 2) { songs++; return track(); }
    songs = 0;
    const clip = advertising ? ad() : dj(); advertising = !advertising;
    return clip;
  };
}
export const GENRE_STATIONS: readonly GenreStation[] = [
  {
    "id": "radio-soma",
    "name": "RADIO SOMA",
    "host": "DJ Dividend",
    "genre": "West Coast G-funk / hip-hop",
    "tagline": "Low rides. High burn.",
    "tracks": [
      {
        "title": "Embarcadero Glide",
        "file": "radio-soma-track-1.mp3",
        "kind": "music"
      },
      {
        "title": "Cap Table Cruiser",
        "file": "radio-soma-track-2.mp3",
        "kind": "music"
      },
      {
        "title": "After the Demo",
        "file": "radio-soma-track-3.mp3",
        "kind": "music"
      },
      {
        "title": "Hills on Hydraulics",
        "file": "radio-soma-track-4.mp3",
        "kind": "music"
      }
    ],
    "dj": [
      {
        "title": "DJ Dividend · 1",
        "file": "radio-soma-dj-1.mp3",
        "kind": "dj",
        "text": "Radio Soma. Low rides, high burn. DJ Dividend at the wheel. Keep your eyes on the street and your pitch out of my inbox."
      },
      {
        "title": "DJ Dividend · 2",
        "file": "radio-soma-dj-2.mp3",
        "kind": "dj",
        "text": "That was another original from the Soma vault. The bass has recurring revenue. Your accelerator badge does not."
      },
      {
        "title": "DJ Dividend · 3",
        "file": "radio-soma-dj-3.mp3",
        "kind": "dj",
        "text": "San Francisco weather advice: keep a jacket in the car. The fog does not accept calendar invitations."
      },
      {
        "title": "DJ Dividend · 4",
        "file": "radio-soma-dj-4.mp3",
        "kind": "dj",
        "text": "Radio Soma traffic: somebody is pivoting across three lanes. Signal before you disrupt, people."
      }
    ]
  },
  {
    "id": "k-dsrupt",
    "name": "K-DSRUPT",
    "host": "Rusty Riff",
    "genre": "Classic rock",
    "tagline": "Real amps. Imaginary exits.",
    "tracks": [
      {
        "title": "Last Exit Before Payroll",
        "file": "k-dsrupt-track-1.mp3",
        "kind": "music"
      },
      {
        "title": "Garage With a View",
        "file": "k-dsrupt-track-2.mp3",
        "kind": "music"
      },
      {
        "title": "Runway to Nowhere",
        "file": "k-dsrupt-track-3.mp3",
        "kind": "music"
      },
      {
        "title": "Pacific Overdrive",
        "file": "k-dsrupt-track-4.mp3",
        "kind": "music"
      }
    ],
    "dj": [
      {
        "title": "Rusty Riff · 1",
        "file": "k-dsrupt-dj-1.mp3",
        "kind": "dj",
        "text": "K Disrupt. Rusty Riff here. Real amps, imaginary exits. Our guitars have six strings and absolutely no subscription tier."
      },
      {
        "title": "Rusty Riff · 2",
        "file": "k-dsrupt-dj-2.mp3",
        "kind": "dj",
        "text": "That was rock and roll, recorded without a strategy offsite. Try getting that past procurement."
      },
      {
        "title": "Rusty Riff · 3",
        "file": "k-dsrupt-dj-3.mp3",
        "kind": "dj",
        "text": "Whatever time your dashboard says, it is time to turn up the guitar. Quietly enough to hear the traffic, obviously."
      },
      {
        "title": "Rusty Riff · 4",
        "file": "k-dsrupt-dj-4.mp3",
        "kind": "dj",
        "text": "K Disrupt. We tried to move the studio into the cloud. The drummer fell off the roof."
      }
    ]
  },
  {
    "id": "burn-rate-fm",
    "name": "BURN RATE FM",
    "host": "Velvet Ledger",
    "genre": "70s funk / disco",
    "tagline": "Make your last dollar dance.",
    "tracks": [
      {
        "title": "Liquid Assets",
        "file": "burn-rate-fm-track-1.mp3",
        "kind": "music"
      },
      {
        "title": "Expense Account Boogie",
        "file": "burn-rate-fm-track-2.mp3",
        "kind": "music"
      },
      {
        "title": "The Velvet Vest",
        "file": "burn-rate-fm-track-3.mp3",
        "kind": "music"
      },
      {
        "title": "Dance Floor Dilution",
        "file": "burn-rate-fm-track-4.mp3",
        "kind": "music"
      }
    ],
    "dj": [
      {
        "title": "Velvet Ledger · 1",
        "file": "burn-rate-fm-dj-1.mp3",
        "kind": "dj",
        "text": "Burn Rate FM. Velvet Ledger with you. Make your last dollar dance. The spreadsheet can wait for the bridge."
      },
      {
        "title": "Velvet Ledger · 2",
        "file": "burn-rate-fm-dj-2.mp3",
        "kind": "dj",
        "text": "That groove has more liquidity than my entire portfolio. Stay loose, San Francisco."
      },
      {
        "title": "Velvet Ledger · 3",
        "file": "burn-rate-fm-dj-3.mp3",
        "kind": "dj",
        "text": "Our weather forecast is seventy percent funk with a chance of sequins. Actual jacket requirements remain extremely high."
      },
      {
        "title": "Velvet Ledger · 4",
        "file": "burn-rate-fm-dj-4.mp3",
        "kind": "dj",
        "text": "Burn Rate FM. The only round closing tonight is the circle on the dance floor."
      }
    ]
  },
  {
    "id": "sf-vc",
    "name": "SF-VC",
    "host": "Cassette Capital",
    "genre": "90s house",
    "tagline": "Four to the floor. Zero to the board.",
    "tracks": [
      {
        "title": "Warehouse Term Sheet",
        "file": "sf-vc-track-1.mp3",
        "kind": "music"
      },
      {
        "title": "Market After Midnight",
        "file": "sf-vc-track-2.mp3",
        "kind": "music"
      },
      {
        "title": "Acid Due Diligence",
        "file": "sf-vc-track-3.mp3",
        "kind": "music"
      },
      {
        "title": "Sunrise on the Ledger",
        "file": "sf-vc-track-4.mp3",
        "kind": "music"
      }
    ],
    "dj": [
      {
        "title": "Cassette Capital · 1",
        "file": "sf-vc-dj-1.mp3",
        "kind": "dj",
        "text": "S F V C. Cassette Capital broadcasting from a warehouse with surprisingly good acoustics and no meeting rooms."
      },
      {
        "title": "Cassette Capital · 2",
        "file": "sf-vc-dj-2.mp3",
        "kind": "dj",
        "text": "Two tracks, zero action items. That is what I call a productive session. S F V C."
      },
      {
        "title": "Cassette Capital · 3",
        "file": "sf-vc-dj-3.mp3",
        "kind": "dj",
        "text": "The city clock keeps moving. So does this kick drum. Take the next corner gently."
      },
      {
        "title": "Cassette Capital · 4",
        "file": "sf-vc-dj-4.mp3",
        "kind": "dj",
        "text": "S F V C. Four to the floor, zero to the board. Your next meeting has been replaced by a bass line."
      }
    ]
  },
  {
    "id": "lofi-hayes-valley",
    "name": "LO-FI HAYES VALLEY",
    "host": "DJ Soft Launch",
    "genre": "Lo-fi beats",
    "tagline": "Beats to miss your stop to.",
    "tracks": [
      {
        "title": "Window Seat Runway",
        "file": "lofi-hayes-valley-track-1.mp3",
        "kind": "music"
      },
      {
        "title": "Succulent Standup",
        "file": "lofi-hayes-valley-track-2.mp3",
        "kind": "music"
      },
      {
        "title": "Fog in the Inbox",
        "file": "lofi-hayes-valley-track-3.mp3",
        "kind": "music"
      },
      {
        "title": "One Nice Little Afternoon",
        "file": "lofi-hayes-valley-track-4.mp3",
        "kind": "music"
      }
    ],
    "dj": [
      {
        "title": "DJ Soft Launch · 1",
        "file": "lofi-hayes-valley-dj-1.mp3",
        "kind": "dj",
        "text": "Lo-fi Hayes Valley. DJ Soft Launch here. Take a breath. The email can develop a personality without you."
      },
      {
        "title": "DJ Soft Launch · 2",
        "file": "lofi-hayes-valley-dj-2.mp3",
        "kind": "dj",
        "text": "That was another little afternoon from our record shelf. Your shoulders are not responsible for the entire company."
      },
      {
        "title": "DJ Soft Launch · 3",
        "file": "lofi-hayes-valley-dj-3.mp3",
        "kind": "dj",
        "text": "If the fog hides your destination, enjoy having fewer tabs open in real life. Bring a layer."
      },
      {
        "title": "DJ Soft Launch · 4",
        "file": "lofi-hayes-valley-dj-4.mp3",
        "kind": "dj",
        "text": "Lo-fi Hayes Valley. Your calendar has a gap. Please do not immediately pave it."
      }
    ]
  },
  {
    "id": "west-coast-tech",
    "name": "WEST COAST TECH RADIO",
    "host": "Pat Pending",
    "genre": "VC talk / call-in satire",
    "tagline": "Opinions with no liquidation preference.",
    "tracks": [
      {
        "title": "the moat",
        "file": "talk-the-moat.mp3",
        "kind": "talk",
        "text": "Today on the Pat Pending show: moats. A caller from a fictional startup says their competitive moat is a spreadsheet only one employee understands. Congratulations. That is not a moat. That is a bus factor wearing a blazer. The caller says they have added artificial intelligence. Excellent. Now two things do not understand the spreadsheet. My producer wants to know our own moat. We broadcast from a room with a door that sticks. Nobody can acquire us because nobody can get in. Coming up: a founder who describes charging money as an exciting experiment. Stay with West Coast Tech Radio."
      },
      {
        "title": "caller from the queue",
        "file": "talk-caller-from-the-queue.mp3",
        "kind": "talk",
        "text": "We have a caller from a Tech Week coffee queue. Caller, what are you building? Apparently a queue for people waiting to join other queues. There is a premium tier that lets you see the queue. Beautiful. A marketplace with both sides standing still. How many customers? The caller says everyone ahead of them. That is an addressable market, not a customer list. My producer has joined the queue. We have lost the producer. If you see someone holding a microphone and explaining network effects to a pastry, please send them back. This is West Coast Tech Radio."
      },
      {
        "title": "the demo",
        "file": "talk-the-demo.mp3",
        "kind": "talk",
        "text": "Welcome back. A fictional founder has sent us a demo with three buttons. The first button says coming soon. The second says request access. The third opens a calendar. Finally, a product with measurable meeting fit. The founder tells me the demo worked yesterday. Yesterday is not available for comment. We invited the engineer, who asked whether we could simply turn the radio off and on again. We tried that, and our audience doubled from one to two. Both are the engineer. After the break, we investigate whether a rooftop mixer is just a very expensive way to find the stairs."
      },
      {
        "title": "exit strategy",
        "file": "talk-exit-strategy.mp3",
        "kind": "talk",
        "text": "Our topic is exit strategies. Listener number one says their exit strategy is leaving the networking event before anyone asks what they do. Sensible. Listener number two has located a side door near the snacks. Strong execution. Listener number three is still saying goodbye forty minutes later. That is a lockup period. Here at West Coast Tech Radio, our own exit is clearly marked and occasionally blocked by a box of promotional tote bags. Remember, a successful evening does not have to include a term sheet. Sometimes you meet a nice person, eat something warm, and catch the right bus. Pat Pending, signing off this segment."
      }
    ],
    "dj": [
      {
        "title": "Pat Pending · 1",
        "file": "west-coast-tech-dj-1.mp3",
        "kind": "dj",
        "text": "West Coast Tech Radio. Pat Pending, opinions with no liquidation preference. Every company on this show is fictional. Several of the business models are too."
      },
      {
        "title": "Pat Pending · 2",
        "file": "west-coast-tech-dj-2.mp3",
        "kind": "dj",
        "text": "You are listening to West Coast Tech Radio. Callers receive one unsolicited opinion and absolutely no investment advice."
      },
      {
        "title": "Pat Pending · 3",
        "file": "west-coast-tech-dj-3.mp3",
        "kind": "dj",
        "text": "Time for our weather desk. It is San Francisco. Bring a jacket and stop asking the cloud for a valuation."
      },
      {
        "title": "Pat Pending · 4",
        "file": "west-coast-tech-dj-4.mp3",
        "kind": "dj",
        "text": "West Coast Tech Radio. Back after these entirely fictional sponsors. Nobody has paid us. This will be obvious."
      }
    ]
  }
];
export const RADIO_ADS: readonly RadioClip[] = [
  {
    "title": "vested interest",
    "file": "ad-vested-interest.mp3",
    "kind": "ad",
    "text": "This Tech Week, dress for the round you want. Vested Interest brings you the sleeveless jacket with twelve pockets for twelve different conference badges. Breathable fabric. Unbreathable valuation. Now with a tiny pocket for your remaining equity. Vested Interest. A fictional product for a very real temperature problem."
  },
  {
    "title": "pivot pillow",
    "file": "ad-pivot-pillow.mp3",
    "kind": "ad",
    "text": "Still lying awake wondering if your startup should become something else? Try the Pivot Pillow. Turn it over and discover a completely new business model. The cool side is enterprise. The other side is community. Pivot Pillow. Sleep on it, then rebrand it. Fictional bedding. Actual exhaustion sold separately."
  },
  {
    "title": "deck dusters",
    "file": "ad-deck-dusters.mp3",
    "kind": "ad",
    "text": "Deck Dusters cleans the slide nobody understands. We remove jargon, polish your hockey stick, and put a little sparkle on the word platform. Our premium service replaces your entire strategy with one tasteful gradient. Deck Dusters. A fictional cleaning company for very dusty pitch decks. Results may contain whitespace."
  },
  {
    "title": "runway noodles",
    "file": "ad-runway-noodles.mp3",
    "kind": "ad",
    "text": "Your company has six months of runway. Your lunch has three minutes. Runway Noodles. The fictional instant meal with a burn rate you can actually afford. Just add hot water and one achievable milestone. Now available in Seed Broth and Series A Spicy. Please do not pitch the kettle."
  },
  {
    "title": "meeting meadow",
    "file": "ad-meeting-meadow.mp3",
    "kind": "ad",
    "text": "Introducing Meeting Meadow. The fictional calendar app that replaces every unnecessary meeting with a picture of grass. Your weekly sync is now a fern. Your alignment session is a small pond. Meeting Meadow. Touch grass without adding another recurring appointment. No lawn care expertise required. Silence is our premium feature."
  },
  {
    "title": "badge barge",
    "file": "ad-badge-barge.mp3",
    "kind": "ad",
    "text": "Too many Tech Week events and only one neck? Badge Barge is the fictional conference lanyard with industrial suspension. Carry every credential you have ever earned, plus three you found near the snacks. Badge Barge. Network harder, stand slightly differently. Not suitable for swimming, sleeping, or modest doorways."
  }
];
