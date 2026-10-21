import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flags } from '@gtasf/shared/flags';
import { createPauseMenu } from './pauseMenu';
vi.mock('@gtasf/shared/flags', () => ({ flags: { hud: true } }));

class Node extends EventTarget {
  children: Node[] = []; parentNode: Node | null = null;
  className = ''; textContent = ''; hidden = false; open = false;
  classList = { add: vi.fn(), remove: vi.fn() };
  constructor(readonly tag: string) { super(); }
  append(...nodes: Node[]) { for (const n of nodes) { n.remove(); n.parentNode = this; this.children.push(n); } }
  before(node: Node) { const p = this.parentNode!; node.parentNode = p; p.children.splice(p.children.indexOf(this), 0, node); }
  after(node: Node) { node.remove(); const p = this.parentNode!; node.parentNode = p; p.children.splice(p.children.indexOf(this) + 1, 0, node); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(n => n !== this); this.parentNode = null; }
  setAttribute() {} focus() {} showModal() { this.open = true; } close() { this.open = false; }
  closest(selector: string) { return selector.includes(this.tag) ? this : null; }
}
let body: Node, home: Node, control: Node, win: EventTarget;
let selectors: Map<string, Node>;
beforeEach(() => {
  Object.assign(flags, { hud: true, radioStations: false, personalRides: true, robotaxi: true, chat: true, feedback: true }); body = new Node('body'); home = new Node('nav'); control = new Node('button');
  body.append(home); home.append(control); selectors = new Map([['#play-controls', home]]); win = new EventTarget();
  vi.stubGlobal('window', win); vi.stubGlobal('Element', Node);
  vi.stubGlobal('document', { body, createElement: (tag: string) => new Node(tag), createComment: () => new Node('comment'), querySelector: (s: string) => selectors.get(s) ?? null });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const escape = () => { const event = new Event('keydown', { cancelable: true }); Object.assign(event, { key: 'Escape', repeat: false }); win.dispatchEvent(event); return event; };

test('Escape opens and closes the menu, retained controls release the modal before dispatch, then restore on destroy', () => {
  let busy = false, modal = false, ran = false;
  const menu = createPauseMenu({ canOpen: () => !busy, onChange: open => { modal = open; }, onHorn() {} })!;
  expect(home.parentNode).not.toBe(body);
  expect(escape().defaultPrevented).toBe(true); expect(menu.isOpen).toBe(true); expect(modal).toBe(true);
  control.addEventListener('click', () => { ran = !modal; });
  // Model browser capture before the original target listener.
  const click = new Event('click'); Object.defineProperty(click, 'target', { value: control });
  menu.element.dispatchEvent(click); control.dispatchEvent(new Event('click'));
  expect(ran).toBe(true); expect(menu.isOpen).toBe(false);
  busy = true; expect(escape().defaultPrevented).toBe(false); expect(menu.isOpen).toBe(false);
  busy = false; escape(); expect(menu.isOpen).toBe(true); escape(); expect(menu.isOpen).toBe(false);
  menu.destroy(); expect(home.parentNode).toBe(body); expect(home.children).toContain(control);
  expect(escape().defaultPrevented).toBe(false);
});

test('shortcuts persist for returning players, follow seat mode and radio flag, and hide for touch', () => {
  vi.stubGlobal('localStorage', { getItem: () => '1', setItem: vi.fn() });
  const menu = createPauseMenu({ canOpen: () => true, onChange() {}, onHorn() {} })!;
  const hint = body.children.find(n => n.className === 'gt-pause-hint')!;
  menu.update(false); expect(hint.hidden).toBe(true);
  menu.update(true); expect(hint.hidden).toBe(false);
  expect(hint.textContent).toBe('Shift run · E enter · G ride\nH robotaxi · M map · V events · T chat · Esc menu');
  vi.spyOn(performance, 'now').mockReturnValue(240_000);
  menu.update(true); expect(hint.hidden).toBe(false);
  menu.update(true, 'driver');
  expect(hint.textContent).toBe('W/S drive · Space brake · E exit\nH robotaxi · M map · Esc menu');
  Object.assign(flags, { radioStations: true }); menu.update(true, 'driver');
  expect(hint.textContent).toBe('W/S drive · Space brake · E exit · [ ] radio\nH robotaxi · M map · Esc menu');
  menu.update(true, 'passenger'); expect(hint.textContent).toBe('E exit · M map · Esc menu');
  menu.update(true, 'on-foot', false, true);
  expect(hint.textContent).toBe('G put away · H robotaxi · M map · Esc menu');
  expect(hint.textContent).not.toContain('boost');
  Object.assign(flags, { personalRides: false, chat: false, robotaxi: false });
  menu.update(true); expect(hint.textContent).toBe('Shift run · E enter\nM map · V events · Esc menu');
  const legend = (menu.element as unknown as Node).children.find(node => node.className === 'gt-pause-key-legend');
  expect(legend?.textContent).toBe('C recenter camera · K feedback');
  menu.update(true, 'passenger', true); expect(hint.hidden).toBe(true);
  menu.update(true, 'on-foot'); expect(hint.hidden).toBe(false);
  menu.show(); menu.update(true); expect(hint.hidden).toBe(true);
  menu.hide(); menu.update(true); expect(hint.hidden).toBe(false);
  menu.destroy(); Object.assign(flags, { hud: false });
  expect(createPauseMenu({ canOpen: () => true, onChange() {}, onHorn() {} })).toBeNull();
  expect(home.parentNode).toBe(body);
});


test('phone feedback is directly reachable in pause and opens through its original handler after resuming', () => {
  const optionsDialog = new Node('dialog'), feedback = new Node('button');
  body.append(optionsDialog); optionsDialog.append(feedback);
  selectors.set('.gt-feedback-launch', feedback);
  let modal = false, feedbackOpened = false;
  feedback.addEventListener('click', () => { feedbackOpened = !modal; });
  const menu = createPauseMenu({ canOpen: () => true, onChange: open => { modal = open; }, onHorn() {} })!;
  menu.show();
  expect(feedback.parentNode?.parentNode).toBe(menu.element);
  expect(feedback.parentNode?.children[0]?.textContent).toBe('Playtest feedback');
  const click = new Event('click'); Object.defineProperty(click, 'target', { value: feedback });
  menu.element.dispatchEvent(click); feedback.dispatchEvent(new Event('click'));
  expect(feedbackOpened).toBe(true); expect(menu.isOpen).toBe(false);
  menu.destroy(); expect(feedback.parentNode).toBe(optionsDialog);
});


test('Escape reaches inline text owners before pause, then opens pause after typing ends', () => {
  const menu = createPauseMenu({ canOpen: () => true, onChange() {}, onHorn() {} })!;
  for (const tag of ['input', 'textarea', 'select']) {
    const composer = new Node(tag), closeComposer = vi.fn();
    composer.addEventListener('keydown', closeComposer);
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key: 'Escape', repeat: false }); Object.defineProperty(event, 'target', { value: composer });
    win.dispatchEvent(event); // window capture runs before the text field's listener
    expect(event.defaultPrevented).toBe(false); expect(menu.isOpen).toBe(false);
    if (!event.defaultPrevented) composer.dispatchEvent(event);
    expect(closeComposer).toHaveBeenCalledOnce();
  }
  expect(escape().defaultPrevented).toBe(true); expect(menu.isOpen).toBe(true);
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { key: 'Escape', repeat: false }); Object.defineProperty(event, 'target', { value: new Node('input') });
  win.dispatchEvent(event); expect(event.defaultPrevented).toBe(true); expect(menu.isOpen).toBe(false);
  menu.destroy();
});
