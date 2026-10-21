/** Radio level under proximity voice (founder Oct 6: 'can't really hear voice because of the radio'). */
export const RADIO_WHILE_TALKING = .1, RADIO_WHILE_LISTENING = .4;
/** Multiplier for the radio: 10% while an audible peer (or you) speaks, 40% while voice listening is on, else 1. */
export function voiceDuck(speaking: boolean, listening: boolean): number {
  return speaking ? RADIO_WHILE_TALKING : listening ? RADIO_WHILE_LISTENING : 1;
}
