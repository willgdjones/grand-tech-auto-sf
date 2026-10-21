import { describe, expect, it } from 'vitest';
import { SA_COLORS, drawOutlinedText, saMoneyCents, saMoneyDollars, saStars } from './saText';

function mockCtx() {
  const calls: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = {
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    strokeText(t: string) { calls.push(`stroke:${t}:${String(state.lineWidth)}:${String(state.strokeStyle)}`); },
    fillText(t: string) { calls.push(`fill:${t}:${String(state.fillStyle)}`); },
    set font(v: string) { state.font = v; }, get font() { return state.font as string; },
    set lineWidth(v: number) { state.lineWidth = v; }, get lineWidth() { return state.lineWidth as number; },
    set strokeStyle(v: string) { state.strokeStyle = v; }, get strokeStyle() { return state.strokeStyle as string; },
    set fillStyle(v: string) { state.fillStyle = v; }, get fillStyle() { return state.fillStyle as string; },
    set lineJoin(v: string) { state.lineJoin = v; }, set miterLimit(v: number) { state.miterLimit = v; },
    set textAlign(v: string) { state.textAlign = v; }, set textBaseline(v: string) { state.textBaseline = v; },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls, state };
}

describe('drawOutlinedText', () => {
  it('strokes the black outline before filling, then restores state', () => {
    const { ctx, calls } = mockCtx();
    drawOutlinedText(ctx, 'SERIES A', 10, 20, { font: '20px sans', fill: SA_COLORS.titleGold, lineWidth: 4 });
    const stroke = calls.findIndex(c => c.startsWith('stroke:SERIES A'));
    const fill = calls.findIndex(c => c.startsWith('fill:SERIES A'));
    expect(stroke).toBeGreaterThan(-1);
    expect(fill).toBeGreaterThan(stroke); // outline under the fill
    expect(calls[0]).toBe('save');
    expect(calls[calls.length - 1]).toBe('restore');
    expect(calls.find(c => c.startsWith('stroke:'))).toContain('4:#000000'); // thick black outline
    expect(calls.find(c => c.startsWith('fill:'))).toContain(SA_COLORS.titleGold);
  });
});

describe('saMoney', () => {
  it('formats cents as SA leading-zero dollars', () => {
    expect(saMoneyCents('25000000')).toBe('$00250000');   // $250,000
    expect(saMoneyCents('50000000')).toBe('$00500000');   // $500,000
    expect(saMoneyCents('230000000000')).toBe('$2300000000'); // $2.3B — longer than the pad, kept whole
    expect(saMoneyCents('-25000000')).toBe('-$00250000');
    expect(saMoneyCents('nonsense')).toBe('$00000000');
  });
  it('formats whole dollars with a minimum width', () => {
    expect(saMoneyDollars(123)).toBe('$00000123');
    expect(saMoneyDollars(0)).toBe('$00000000');
    expect(saMoneyDollars(-5)).toBe('-$00000005');
  });
});

describe('saStars', () => {
  it('fills stage stars out of five', () => {
    expect(saStars(3).glyphs).toBe('★★★☆☆');
    expect(saStars(0).glyphs).toBe('☆☆☆☆☆');
    expect(saStars(9).glyphs).toBe('★★★★★'); // clamped
  });
});
