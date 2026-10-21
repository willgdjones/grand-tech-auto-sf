import { describe, expect, it } from 'vitest';
import { BILLBOARD_SURFACES } from '@gtasf/shared/content/billboards';
import { SKY_AD_CRAFT } from '@gtasf/shared/content/skyAds';
import { adSlotInfo } from './adSlotPage';

describe('adSlotInfo', () => {
  it('resolves a real billboard slot to id/location/price', () => {
    const surface = BILLBOARD_SURFACES[0]!;
    const info = adSlotInfo({ kind: 'billboard', id: surface.id });
    expect(info).not.toBeNull();
    expect(info!.slotId).toBe(surface.id);
    expect(info!.title).toBe(surface.name);
    expect(info!.subtitle).toContain(surface.district.toUpperCase());
    expect(info!.priceLabel).toMatch(/\$[\d,]+\/week/);
  });

  it('resolves a sky-ad slot by craft id or slot id', () => {
    const craft = SKY_AD_CRAFT[0]!;
    const byId = adSlotInfo({ kind: 'sky', id: craft.id });
    const bySlot = adSlotInfo({ kind: 'sky', id: craft.slotId });
    expect(byId?.slotId).toBe(craft.slotId);
    expect(bySlot?.slotId).toBe(craft.slotId);
    expect(byId!.priceLabel).toMatch(/\$500/);
  });

  it('returns null for an unknown id', () => {
    expect(adSlotInfo({ kind: 'billboard', id: 'nope' })).toBeNull();
    expect(adSlotInfo({ kind: 'sky', id: 'nope' })).toBeNull();
  });
});
