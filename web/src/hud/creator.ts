/**
 * Creator credit. Removed at the founder's request (Oct 4): nothing is mounted on the HUD or the
 * loading card. The function stays so main.ts's call site and destroy wiring keep compiling.
 */
export function createCreatorLinks(_options: { parent?: HTMLElement; loadingParent?: HTMLElement | null } = {}): { destroy(): void } | null {
  return null;
}
