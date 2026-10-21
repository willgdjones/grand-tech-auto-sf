import { expect, test } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, RingGeometry, Sprite, SpriteMaterial, Vector2 } from 'three';
import { publicEventUrl, pickEventLink, type EventLinkTarget } from './worldEventLinks';
import type { RadarEvent } from '../radar/radar';

test('only absolute public HTTP(S) links can open', () => {
  expect(publicEventUrl('https://example.com/event?a=1#rsvp')).toBe('https://example.com/event?a=1#rsvp');
  expect(publicEventUrl(' http://example.com ')).toBe('http://example.com/');
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '/events/one', '//example.com', 'ftp://example.com', 'https:example.com', '', 'https://', null]) {
    expect(publicEventUrl(url)).toBeNull();
  }
});

function setup() {
  const camera = new PerspectiveCamera(60, 1, .1, 100); camera.position.z = 5;
  const root = new Group();
  const sprite = new Sprite(new SpriteMaterial()); sprite.position.z = 1; sprite.scale.set(2, 2, 1);
  const ring = new Mesh(new RingGeometry(.4, 2), new MeshBasicMaterial()); root.add(sprite, ring);
  const event = { id: 'representative-live-event', title: 'Live gathering', url: 'https://example.com/live' } as RadarEvent;
  const targets: EventLinkTarget[] = [{ object: ring, event: { ...event, id: 'ring' }, kind: 'ring' }, { object: sprite, event, kind: 'label' }];
  return { camera, root, sprite, ring, event, targets };
}
test('raycasts actual sprites before rings and returns the representative event', () => {
  const { camera, targets, event, sprite } = setup();
  expect(pickEventLink(camera, new Vector2(.2, 0), targets)?.event).toBe(event);
  sprite.visible = false;
  expect(pickEventLink(camera, new Vector2(.2, 0), targets)?.event.id).toBe('ring');
  expect(pickEventLink(camera, new Vector2(.95, .95), targets)).toBeNull();
});
test('hidden parents, detached pooled sprites, invalid links and behind-camera geometry cannot be clicked', () => {
  const { camera, targets, root, sprite, ring, event } = setup();
  root.visible = false; expect(pickEventLink(camera, new Vector2(.2, 0), targets)).toBeNull();
  root.visible = true; ring.visible = false; sprite.removeFromParent();
  expect(pickEventLink(camera, new Vector2(), targets)).toBeNull();
  root.add(sprite); event.url = 'javascript:alert(1)';
  expect(pickEventLink(camera, new Vector2(), targets)).toBeNull();
  event.url = 'https://example.com/'; sprite.position.z = 10;
  expect(pickEventLink(camera, new Vector2(), targets)).toBeNull();
});
