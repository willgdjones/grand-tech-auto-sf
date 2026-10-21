import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeEmailDialogs, isEmailDialogOpen, openEmailCapture } from './card';
import { startEmailCapture, verifyEmailCode } from './client';
import { track } from '../analytics';
import { flags } from '@gtasf/shared/flags';
import { openSaveStartup } from '../recovery/panel';
import type { EmailStartResponse, EmailVerifyResponse } from '@gtasf/shared/email/contract';

vi.mock('./client', () => ({ emailStatus: vi.fn(), startEmailCapture: vi.fn(), verifyEmailCode: vi.fn() }));
vi.mock('../input/cursor', () => ({ holdFreeCursor: () => () => {} }));
vi.mock('../analytics', () => ({ track: vi.fn() }));
vi.mock('@gtasf/shared/flags', () => ({ flags: { accountRecovery: true } }));
vi.mock('../recovery/panel', () => ({ openSaveStartup: vi.fn() }));

// Native close events are queued: network completions may arrive after open becomes false.
class Element extends EventTarget {
  children: Element[] = [];
  parent?: Element;
  className = '';
  textContent = '';
  value = '';
  open = false;
  hidden = false;
  disabled = false;
  dataset: Record<string, string> = {};
  onclick?: () => unknown;
  constructor(readonly tag: string) { super(); }
  append(...children: Element[]) { for (const child of children) { child.parent = this; this.children.push(child); } }
  insertBefore(child: Element, before: Element) { child.parent = this; this.children.splice(this.children.indexOf(before), 0, child); }
  replaceChildren(...children: Element[]) { this.children = []; this.append(...children); }
  setAttribute() {}
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; setTimeout(() => this.dispatchEvent(new Event('close')), 0); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  find(predicate: (element: Element) => boolean): Element | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) { const match = child.find(predicate); if (match) return match; }
    return undefined;
  }
  querySelector(selector: string) { return this.find(element => element.className.split(' ').includes(selector.slice(1))); }
  async click() { if (!this.disabled) await this.onclick?.(); }
}

let body: Element;
const send = vi.mocked(startEmailCapture), verify = vi.mocked(verifyEmailCode);
const sent = (resendAfterSec: number): EmailStartResponse => ({ sent: true, resendAfterSec, expiresInMin: 30 });
const verified: EmailVerifyResponse = { verified: true, reward: { verifiedFounder: true, bonusCents: 25_000 } };
const field = (className: string) => body.querySelector(`.${className}`)!;
const button = (label: string) => body.find(element => element.tag === 'button' && element.textContent === label)!;
function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function enterCode(onVerified = vi.fn()) {
  openEmailCapture({ onVerified });
  field('gt-email-input').value = 'founder@example.com';
  await button('Email me a code').click();
  field('gt-email-code').value = '123456';
  return onVerified;
}

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  Object.assign(flags, { accountRecovery: true });
  body = new Element('body');
  vi.stubGlobal('document', { body, createElement: (tag: string) => new Element(tag), pointerLockElement: null });
  send.mockReset().mockResolvedValue(sent(2));
  verify.mockReset().mockResolvedValue(verified);
});
afterEach(() => {
  closeEmailDialogs(); vi.runOnlyPendingTimers();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it('lets a player retry verification after a network failure', async () => {
  verify.mockRejectedValueOnce(new Error('offline'));
  const onVerified = await enterCode();
  await button('Verify').click();
  expect(button('Verify').disabled).toBe(false);
  expect(field('gt-email-status').textContent).toContain('Try again');
  expect(onVerified).not.toHaveBeenCalled();
  await button('Verify').click();
  expect(onVerified).toHaveBeenCalledExactlyOnceWith(verified.reward);
  expect(field('gt-email-title').textContent).toBe('Email verified');
  expect(verify).toHaveBeenCalledTimes(2);
});

it('ignores a send that finishes after the player dismisses the card', async () => {
  const response = deferred<EmailStartResponse>(); send.mockReturnValueOnce(response.promise);
  const onDismissed = vi.fn();
  openEmailCapture({ onDismissed });
  field('gt-email-input').value = 'founder@example.com';
  const pending = button('Email me a code').click();
  closeEmailDialogs();
  expect(isEmailDialogOpen()).toBe(false);
  response.resolve(sent(60)); await pending;
  vi.runOnlyPendingTimers();
  expect(onDismissed).toHaveBeenCalledOnce();
  expect(body.children).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('uses each resend response cooldown and permits another resend after expiry', async () => {
  send.mockResolvedValueOnce(sent(2)).mockResolvedValueOnce(sent(3)).mockResolvedValueOnce(sent(5));
  await enterCode();
  expect(button('Resend in 2s').disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);
  await button('Resend code').click();
  expect(button('Resend in 3s').disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(button('Resend in 1s').disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  await button('Resend code').click();
  expect(button('Resend in 5s').disabled).toBe(true);
  expect(send).toHaveBeenCalledTimes(3);
  closeEmailDialogs(); vi.runOnlyPendingTimers();
  expect(vi.getTimerCount()).toBe(0);
});

it('allows retry after resend fails without claiming a code was sent', async () => {
  send.mockResolvedValueOnce(sent(0)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(sent(7));
  await enterCode();
  await button('Resend code').click();
  expect(field('gt-email-status').textContent).toContain('Could not resend');
  expect(button('Resend code').disabled).toBe(false);
  await button('Resend code').click();
  expect(button('Resend in 7s').disabled).toBe(true);
});

it('does not reveal a reward or call the old owner after closing during verification', async () => {
  const response = deferred<EmailVerifyResponse>(); verify.mockReturnValueOnce(response.promise);
  const onVerified = await enterCode();
  const pending = button('Verify').click();
  closeEmailDialogs(); response.resolve(verified); await pending;
  vi.runOnlyPendingTimers();
  expect(onVerified).not.toHaveBeenCalled();
  expect(track).not.toHaveBeenCalled();
  expect(body.children).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});


it('offers the existing recovery-code flow after verification and releases the email modal first', async () => {
  vi.mocked(openSaveStartup).mockImplementationOnce(() => { expect(isEmailDialogOpen()).toBe(false); });
  await enterCode(); await button('Verify').click();
  expect(field('gt-email-blurb').textContent).toBe('Your email is verified. We’ll send you a Tech Week recap.');
  await button('Get recovery code').click();
  expect(openSaveStartup).toHaveBeenCalledOnce();
  expect(isEmailDialogOpen()).toBe(false);
});

it('does not offer recovery when the existing recovery flag is disabled', async () => {
  Object.assign(flags, { accountRecovery: false });
  await enterCode(); await button('Verify').click();
  expect(button('Get recovery code')).toBeUndefined();
  expect(openSaveStartup).not.toHaveBeenCalled();
});
