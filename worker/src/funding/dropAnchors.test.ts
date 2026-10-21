import { expect, it } from 'vitest';
import { DROP_LOCATIONS } from '@gtasf/shared/drops';
import { fundingAnchor } from './anchors';

// Reachability guard: WorldDrops skips any drop whose location cannot snap to the active road
// graph, which would leave a 15-minute rotation with no visible drop. Every scheduled spot must
// resolve on the default Ferry->Lombard corridor graph so a drop is always findable in local play.
it('every fund-drop location snaps to the playable road graph', () => {
  const unresolved = DROP_LOCATIONS.filter(location => fundingAnchor(location) === null).map(location => location.label);
  expect(unresolved).toEqual([]);
});
