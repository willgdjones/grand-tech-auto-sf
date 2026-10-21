import { describe, expect, it } from 'vitest';
import { BILLBOARD_PRICE_TIERS, BILLBOARD_SURFACES } from './billboards';
import type { BillboardDistrict } from './billboards';
import { RADIO_STATIONS } from './radio';
import {
  FUNDED_TIERS, MISSION_PASSED, MISSION_TEXT, NPC_CHATTER,
  RUNWAY_ENDED, RUNWAY_ENDINGS, SF_HAZARDS,
} from './flavour';

function unique(values: readonly string[]): void {
  expect(new Set(values).size).toBe(values.length);
}

function readable(text: string): void {
  expect(text.trim()).toBe(text);
  expect(text.length).toBeGreaterThan(0);
  expect(text.length).toBeLessThanOrEqual(240);
  expect(text).not.toMatch(/[<>\n\r]|\b(?:TODO|TBD|lorem ipsum)\b/i);
}

describe('billboard placement data', () => {
  it('has stable, distinct faces across every requested corridor', () => {
    // Named-spot slots (61602f9) grew the catalogue past the original 150 corridor faces.
    expect(BILLBOARD_SURFACES.length).toBeGreaterThanOrEqual(150);
    unique(BILLBOARD_SURFACES.map(face => face.id));
    unique(BILLBOARD_SURFACES.map(face => `${face.lat},${face.lon},${face.headingDeg}`));
    const expected: Record<BillboardDistrict, number> = {
      'us-101': 26, 'i-80': 24, 'bay-bridge-toll': 10,
      market: 26, soma: 24, embarcadero: 20, mission: 20,
    };
    for (const [district, count] of Object.entries(expected)) {
      expect(BILLBOARD_SURFACES.filter(face => face.district === district).length).toBeGreaterThanOrEqual(count);
    }
  });

  it('keeps coordinates in their named corridors and marks the Oakland exception', () => {
    // Loose geographic envelopes catch swapped lat/lon, wrong-city points and
    // accidental clamping of Oakland into the SF map. They do not prove sightlines.
    const bounds: Record<BillboardDistrict, readonly [number, number, number, number]> = {
      'us-101': [-122.424, 37.712, -122.390, 37.772],
      'i-80': [-122.410, 37.769, -122.389, 37.788],
      'bay-bridge-toll': [-122.320, 37.820, -122.300, 37.830],
      market: [-122.424, 37.773, -122.392, 37.796],
      soma: [-122.424, 37.768, -122.389, 37.791],
      embarcadero: [-122.416, 37.781, -122.387, 37.810],
      mission: [-122.430, 37.747, -122.411, 37.771],
    };
    for (const face of BILLBOARD_SURFACES) {
      const [west, south, east, north] = bounds[face.district];
      expect(face.lon, face.id).toBeGreaterThanOrEqual(west);
      expect(face.lon, face.id).toBeLessThanOrEqual(east);
      expect(face.lat, face.id).toBeGreaterThanOrEqual(south);
      expect(face.lat, face.id).toBeLessThanOrEqual(north);
      if (face.district === 'bay-bridge-toll') {
        expect(face.coverage).toBe('regional-backdrop');
        expect(face.sourceStreetCnn).toBeNull();
        expect(face.lon).toBeGreaterThan(-122.348); // East of current SF_BBOX.
      } else {
        expect(face.coverage).toBe('sf');
        if (face.sourceStreetCnn !== null) expect(face.sourceStreetCnn).toMatch(/^\d+$/);
        expect(face.lon).toBeLessThan(-122.348);
      }
    }
  });

  it('supplies renderable dimensions, compass bearings and exact weekly cents', () => {
    for (const tier of Object.values(BILLBOARD_PRICE_TIERS)) {
      expect(Number.isSafeInteger(tier.baseWeeklyCents)).toBe(true);
      expect(tier.baseWeeklyCents).toBeGreaterThan(0);
    }
    for (const face of BILLBOARD_SURFACES) {
      expect(face.headingDeg).toBeGreaterThanOrEqual(0);
      expect(face.headingDeg).toBeLessThan(360);
      expect(face.widthMetres).toBeGreaterThan(face.heightMetres);
      expect(face.heightMetres).toBeGreaterThan(0);
      expect(face.centerHeightAboveGroundMetres).toBeGreaterThan(face.heightMetres / 2);
      expect(BILLBOARD_PRICE_TIERS[face.baseWeeklyPriceTier]).toBeDefined();
      for (const value of [face.lat, face.lon, face.headingDeg, face.widthMetres,
        face.heightMetres, face.centerHeightAboveGroundMetres]) {
        expect(Number.isFinite(value), face.id).toBe(true);
      }
    }
  });
});

describe('radio and SF flavour data', () => {
  it('provides three distinct stations with enough original ticker-length scripts', () => {
    expect(RADIO_STATIONS.map(station => station.name)).toEqual([
      'KVC Radio', 'Lo-fi Hayes Valley', 'BART Delays FM',
    ]);
    unique(RADIO_STATIONS.map(station => station.id));
    const allLines: string[] = [];
    for (const station of RADIO_STATIONS) {
      expect(station.djLines.length).toBeGreaterThanOrEqual(40);
      for (const text of [station.host, station.tagline, ...station.djLines]) readable(text);
      allLines.push(...station.djLines);
    }
    unique(allLines);
  });

  it('orders all six funded levels from Seed to Unicorn with increasing visit thresholds', () => {
    expect(FUNDED_TIERS.map(tier => tier.stars)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(FUNDED_TIERS[0].name).toBe('Seed');
    expect(FUNDED_TIERS.at(-1)?.name).toBe('Unicorn');
    unique(FUNDED_TIERS.map(tier => tier.id));
    let previous = 0;
    for (const tier of FUNDED_TIERS) {
      expect(Number.isSafeInteger(tier.minValidatedVisits)).toBe(true);
      expect(tier.minValidatedVisits).toBeGreaterThan(previous);
      previous = tier.minValidatedVisits;
      readable(tier.toast);
    }
  });

  it('provides complete, addressable mission, failure, hazard and NPC copy', () => {
    expect(MISSION_PASSED).toBe('MISSION PASSED');
    expect(RUNWAY_ENDED).toBe('RUNWAY ENDED');
    unique(MISSION_TEXT.map(mission => mission.id));
    unique(RUNWAY_ENDINGS.map(ending => ending.id));
    unique(SF_HAZARDS.map(hazard => hazard.id));
    unique(NPC_CHATTER.map(group => group.id));
    expect(SF_HAZARDS.map(hazard => hazard.id)).toEqual(expect.arrayContaining([
      'coned-robotaxi', 'late-muni', 'parking-meter', 'delivery-robot', 'crypto-billboard',
    ]));
    for (const mission of MISSION_TEXT) {
      for (const text of [mission.title, mission.objective, mission.passed]) readable(text);
    }
    for (const ending of RUNWAY_ENDINGS) {
      readable(ending.reason);
      readable(ending.retry);
    }
    for (const hazard of SF_HAZARDS) {
      for (const text of [hazard.title, hazard.warning, hazard.detail, hazard.advice]) readable(text);
    }
    const chatter: string[] = [];
    for (const group of NPC_CHATTER) {
      expect(group.lines.length).toBeGreaterThanOrEqual(6);
      for (const line of group.lines) readable(line);
      chatter.push(...group.lines);
    }
    unique(chatter);
  });
});
