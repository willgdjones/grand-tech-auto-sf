import { afterEach, expect, test, vi } from 'vitest';
import { flags } from '@gtasf/shared/flags';
import { freshOnboarding } from '@gtasf/shared/onboarding/state';
import type { EmailStatus } from '@gtasf/shared/email/contract';
import { createOnboardingFlow } from '../onboarding/flow';
import { createEmailCaptureIntegration } from './integrate';
import { emailStatus } from './client';
import { openEmailCapture } from './card';

vi.mock('@gtasf/shared/flags', () => ({ flags: { emailCapture: true } }));
vi.mock('./client', () => ({ emailStatus: vi.fn() }));
const dialog = vi.hoisted(() => ({ open: false }));
vi.mock('./card', () => ({ isEmailDialogOpen: () => dialog.open,
  openEmailCapture: vi.fn(() => { dialog.open = true; }) }));

class Node extends EventTarget {
  hidden = false; disabled = false; textContent = ''; type = ''; className = '';
  children: Node[] = []; parent?: Node;
  append(child: Node) { child.parent = this; this.children.push(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  click() { this.dispatchEvent(new Event('click')); }
}
const usable: EmailStatus = { available: true, verified: false, rewarded: false, pending: false };
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function setup(initialFailure = false) {
  vi.stubGlobal('document', { createElement: () => new Node() });
  vi.mocked(emailStatus).mockResolvedValue(usable);
  if (initialFailure) vi.mocked(emailStatus).mockRejectedValueOnce(new Error('offline'));
  const persist = vi.fn();
  const flow = createOnboardingFlow({ state: { ...freshOnboarding(), step: 'intro' },
    persist, isTouch: false, ui: { showSlides() {}, hideSlides() {}, setMissionStep() {}, clearMission() {},
      stinger() {}, showHint() {}, revealPanels() {}, requestIdentity() {} } });
  const parent = new Node();
  let clear = true, stopped = true;
  const closeOptions = vi.fn(() => { clear = true; });
  const integration = createEmailCaptureIntegration({ parent: parent as unknown as HTMLElement,
    onboarding: () => flow, closeOptions, canOpen: () => clear, canAutoPrompt: () => stopped,
    onStatus: vi.fn() })!;
  return { flow, parent, persist, integration, closeOptions,
    modal(value: boolean) { clear = !value; }, moving(value: boolean) { stopped = !value; } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); dialog.open = false; Object.assign(flags, { emailCapture: true }); });

test('automatic offers wait for the paint + walk steps and idle play, persist when shown, and stop after two across replay', async () => {
  const h = setup(); await h.integration.ready;
  h.integration.onAward(false); h.integration.tick(); await flush();
  expect(openEmailCapture).not.toHaveBeenCalled();
  h.flow.stepCleared('intro'); h.flow.stepCleared('walk'); h.moving(true); h.integration.tick(); await flush();
  expect(openEmailCapture).not.toHaveBeenCalled();
  h.moving(false); h.integration.tick(); await flush();
  expect(openEmailCapture).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'onboarding' }));
  expect(h.flow.state.emailPrompts).toBe(1);
  expect(h.persist).toHaveBeenLastCalledWith(expect.objectContaining({ emailPrompts: 1 }));
  dialog.open = false;
  h.integration.onAward(false); h.integration.tick(); await flush();
  expect(openEmailCapture).toHaveBeenCalledTimes(1);
  h.integration.onAward(true); h.modal(true); h.integration.tick(); await flush();
  expect(openEmailCapture).toHaveBeenCalledTimes(1);
  h.modal(false); h.integration.tick(); await flush();
  expect(openEmailCapture).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'first_star' }));
  expect(h.flow.state.emailPrompts).toBe(2);
  dialog.open = false; h.flow.replay();
  h.integration.onAward(true); h.integration.tick(); await flush();
  expect(h.flow.state.emailPrompts).toBe(2); expect(openEmailCapture).toHaveBeenCalledTimes(2);
  h.integration.destroy();
});

test('unavailable or already verified services do not prompt, while explicit saving does not spend automatic offers', async () => {
  const h = setup(); await h.integration.ready;
  const entry = h.parent.children[0]!;
  h.modal(true); entry.click(); await flush();
  expect(h.closeOptions).toHaveBeenCalledOnce();
  expect(openEmailCapture).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'game_options' }));
  expect(h.flow.state.emailPrompts).toBe(0);
  dialog.open = false; h.flow.stepCleared('intro'); h.flow.stepCleared('walk');
  for (const status of [{ ...usable, available: false }, { ...usable, verified: true, rewarded: true }]) {
    vi.mocked(emailStatus).mockResolvedValueOnce(status);
    h.integration.onAward(false); h.integration.tick(); await flush();
    expect(openEmailCapture).toHaveBeenCalledTimes(1);
    expect(h.flow.state.emailPrompts).toBe(0);
  }
  expect(entry.disabled).toBe(true); expect(entry.textContent).toContain('verified');
  h.integration.destroy();
});

test('a late status response rechecks dialogs and teardown and a failed lookup does not retry every frame', async () => {
  const h = setup(); await h.integration.ready;
  h.flow.stepCleared('intro'); h.flow.stepCleared('walk');
  const delayed = deferred<EmailStatus>();
  vi.mocked(emailStatus).mockReturnValueOnce(delayed.promise);
  h.integration.onAward(false); h.integration.tick(); h.modal(true);
  delayed.resolve(usable); await flush();
  expect(openEmailCapture).not.toHaveBeenCalled(); expect(h.flow.state.emailPrompts).toBe(0);
  h.modal(false); vi.mocked(emailStatus).mockRejectedValueOnce(new Error('offline'));
  h.integration.tick(); await flush();
  const calls = vi.mocked(emailStatus).mock.calls.length;
  for (let i = 0; i < 10; i++) h.integration.tick();
  await flush(); expect(emailStatus).toHaveBeenCalledTimes(calls);
  const late = deferred<EmailStatus>(); vi.mocked(emailStatus).mockReturnValueOnce(late.promise);
  h.integration.onAward(false); h.integration.tick(); h.integration.destroy();
  late.resolve(usable); await flush();
  expect(openEmailCapture).not.toHaveBeenCalled(); expect(h.parent.children).toHaveLength(0);
});

test('the feature flag prevents mounting and availability requests', () => {
  Object.assign(flags, { emailCapture: false });
  const h = setup();
  expect(h.integration).toBeNull(); expect(h.parent.children).toHaveLength(0);
  expect(emailStatus).not.toHaveBeenCalled();
});


test('a failed startup lookup exposes manual retry without a polling loop or spent automatic offer', async () => {
  const h = setup(true); await h.integration.ready;
  const entry = h.parent.children[0]!;
  expect(entry.hidden).toBe(false); expect(entry.disabled).toBe(false);
  expect(entry.textContent).toBe('Retry email saving');
  for (let i = 0; i < 20; i++) h.integration.tick();
  await flush(); expect(emailStatus).toHaveBeenCalledTimes(1);
  entry.click(); await flush();
  expect(emailStatus).toHaveBeenCalledTimes(2);
  expect(openEmailCapture).toHaveBeenCalledWith(expect.objectContaining({ source: 'game_options' }));
  expect(h.integration.available).toBe(true);
  expect(entry.textContent).toBe('Save your startup with email');
  expect(h.flow.state.emailPrompts).toBe(0);
  h.integration.destroy();
});

test('retry stays possible after another failure but a confirmed unavailable service hides the entry', async () => {
  const h = setup(true); await h.integration.ready;
  const entry = h.parent.children[0]!;
  vi.mocked(emailStatus).mockRejectedValueOnce(new Error('still offline'));
  entry.click(); await flush();
  expect(entry.hidden).toBe(false); expect(entry.disabled).toBe(false);
  expect(entry.textContent).toBe('Retry email saving');
  vi.mocked(emailStatus).mockResolvedValueOnce({ ...usable, available: false });
  entry.click(); await flush();
  expect(entry.hidden).toBe(true);
  expect(openEmailCapture).not.toHaveBeenCalled();
  expect(h.flow.state.emailPrompts).toBe(0);
  h.integration.destroy();
});
