import { flags } from '@gtasf/shared/flags';
import { initReferrals, refreshReferralProfile, referralAction, referralClaimMessage, referralShareUrl } from './client';
import './referrals.css';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
export function createReferralPanel(options: { parent?: HTMLElement; onModalChange?(open: boolean): void } = {}) {
  if (!flags.referrals) return null;
  const button = element('button', 'Invite friends, raise faster', 'gt-referral-launch'); button.type = 'button';
  const dialog = element('dialog', '', 'gt-referral-panel'); dialog.setAttribute('aria-labelledby', 'gt-referral-title');
  const title = element('h2', 'Invite friends, raise faster'); title.id = 'gt-referral-title';
  const close = element('button', 'Close ×', 'gt-referral-close'); close.type = 'button';
  const intro = element('p', 'Share your link. When a friend joins and actually plays, you both get funded — all in-game, no cash.');
  const copy = element('button', 'Copy my link'); copy.type = 'button';
  const link = element('input'); link.readOnly = true; link.setAttribute('aria-label', 'Your referral link');
  const stats = element('dl', '', 'gt-referral-stats');
  const values = new Map<string, HTMLElement>();
  // In-game pivot: 'Clicks' = link opens, 'Players' = friends who joined and played (each a Warm intro).
  // The old cash stats (Pending/Available) and refund line are gone — rewards are cap-table funding only.
  for (const label of ['Clicks', 'Players']) { const value = element('dd', '—'); values.set(label, value); stats.append(element('dt', label), value); }
  const funding = element('p', `A friend who joins via your link and plays earns you a ${flags.economyV3 ? '$10k' : '$5M'} “Warm intro” on your cap table, and they get a welcome cheque for arriving. Reach 5 friends for a bonus round and 10 for the Network effect. Fictional in-game funding only — it can’t be spent or cashed out.`);
  const form = element('form'), emailLabel = element('label', 'Verify your email (keeps rewards fair)'), email = element('input');
  email.type = 'email'; email.autocomplete = 'email'; email.required = true; email.maxLength = 320; email.placeholder = 'you@example.com';
  emailLabel.append(email);
  const verify = element('button', 'Send verification link'); verify.type = 'submit'; form.append(emailLabel, verify);
  const account = element('p'), cashout = element('p', 'One reward per friend, per device — referred players must actually play. All rewards are in-game funding; there is no cash payout.');
  const status = element('p', '', 'gt-referral-status'); status.setAttribute('role', 'status');
  dialog.append(close, title, intro, link, copy, stats, funding, form, account, cashout, status);
  (options.parent ?? document.body).append(button); document.body.append(dialog);
  let disposed = false, loading = false, announcedOpen = false;
  async function refresh() {
    if (loading || disposed) return;
    loading = true; copy.disabled = true;
    try {
      await initReferrals(); const profile = await refreshReferralProfile();
      if (disposed) return;
      link.value = await referralShareUrl(new URL('/', location.origin));
      values.get('Clicks')!.textContent = String(profile.clicks); values.get('Players')!.textContent = String(profile.players);
      form.hidden = profile.claimed; verify.disabled = !profile.claimEnabled;
      account.textContent = profile.claimed ? 'Email verified — keeps your referrals fair.' : profile.claimEnabled
        ? 'Open the email link in this browser to verify (it keeps referral rewards fair).'
        : 'Email delivery is not available yet. Your referrals are still tracked on this device.';
      status.textContent = referralClaimMessage(); copy.disabled = false;
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Referral information is unavailable.'; }
    finally { loading = false; }
  }
  function open() {
    if (disposed) return;
    if (!dialog.open) { onClose(); announcedOpen = true; options.onModalChange?.(true); dialog.showModal(); }
    close.focus(); void refresh();
  }
  function hide() { if (dialog.open) dialog.close(); onClose(); }
  function onClose() {
    // Native close restores focus immediately; its queued event may belong to
    // a previous opening or arrive after another HUD control has taken focus.
    if (dialog.open || !announcedOpen) return;
    announcedOpen = false; options.onModalChange?.(false);
  }
  button.addEventListener('click', open); close.addEventListener('click', hide);
  dialog.addEventListener('close', onClose);
  dialog.addEventListener('cancel', event => { event.preventDefault(); hide(); });
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(link.value); status.textContent = 'Referral link copied.'; } catch { link.focus(); link.select(); status.textContent = 'Select and copy your link.'; } });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity() || verify.disabled) return;
    verify.disabled = true;
    try { status.textContent = await referralAction('claim', { email: email.value }); }
    catch (error) { status.textContent = error instanceof Error ? error.message : 'Email verification is unavailable.'; }
    finally { verify.disabled = false; }
  });
  return { button, open, hide, get modalOpen() { return dialog.open; }, destroy() { disposed = true; hide(); dialog.remove(); button.remove(); } };
}
