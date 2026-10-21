import { flags } from '@gtasf/shared/flags';
import { createAvatarTemplate, type AvatarTemplate } from './riggedAvatar';
import { afterReady, loadPeopleGltf, MESHY_OFFICER, PEOPLE_BODIES } from './peopleAssets';

/** cc0People (lane D, gtasf-laned-cc0-characters-km1i6): CC0 Quaternius Ultimate Modular Men/Women bodies on the
 * hoodie's rig (tools/assets/build-people.mjs; licences in web/public/assets/LICENSES.md). Each is an ordinary avatar
 * template, so the shared idle/walk/run/sit clips, drive pose and outfit code apply unchanged. */
export { PEOPLE_BODIES };

const templates = new Map<string, Promise<AvatarTemplate | null>>();
/** Templates for `ids` (default: the whole pool), each built once, after READY (never on the first-load path); a failed body
 * is skipped. Phone Low asks for a small subset (lowNearPeople) so it never parses the whole pool. */
export async function loadPeopleTemplates(ids: readonly string[] = PEOPLE_BODIES): Promise<AvatarTemplate[]> {
  if (!flags.cc0People || !flags.onFoot) return [];
  const loaded = await Promise.all(ids.map(id => {
    let pending = templates.get(id);
    if (!pending) { pending = loadPeopleGltf(id).then(createAvatarTemplate, () => null); templates.set(id, pending); }
    return pending;
  }));
  return loaded.filter((template): template is AvatarTemplate => template !== null);
}

let officer: AvatarTemplate | null = null, officerRequested = false;
/** meshyPeople: the Meshy SFPD officer template once loaded (after READY), else null (callers keep the recoloured hoodie). */
export function meshyOfficerTemplate(): AvatarTemplate | null {
  if (!flags.meshyPeople || !flags.onFoot) return null;
  if (!officerRequested) { officerRequested = true; void loadPeopleGltf(MESHY_OFFICER).then(gltf => { officer = createAvatarTemplate(gltf); }, () => { /* keep the hoodie officer */ }); }
  return officer;
}
// Pre-warm the Meshy officer after READY so the first officers of a session aren't hoodie fallbacks (review 2026-10-14).
if (flags.meshyPeople && flags.onFoot) void afterReady().then(() => { meshyOfficerTemplate(); });
