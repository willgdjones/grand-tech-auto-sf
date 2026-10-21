import { describe, expect, it } from 'vitest';
import type { DirectionalLight } from 'three';
import { hdriForTime, realisticFog, configureSunShadows } from './realistic';
import type { TimeGrade } from './timeGrade';

const grade = (o: Partial<TimeGrade>) => o as TimeGrade;

describe('realistic renderer helpers', () => {
  it('maps SF time of day to the matching HDRI bucket', () => {
    expect(hdriForTime(grade({ night: 1, hour: 23 }))).toBe('night');
    expect(hdriForTime(grade({ night: 0.2, hour: 18.25 }))).toBe('golden');
    expect(hdriForTime(grade({ night: 0.5, hour: 19.25 }))).toBe('dusk');
    expect(hdriForTime(grade({ night: 0, hour: 7 }))).toBe('partly-cloudy');
    expect(hdriForTime(grade({ night: 0, hour: 12 }))).toBe('midday');
  });

  it('uses much less fog than the PS2 haze', () => {
    const fog = realisticFog(grade({ fogNear: 160, fogFar: 820 }));
    expect(fog.near).toBeGreaterThanOrEqual(300);
    expect(fog.far).toBeGreaterThanOrEqual(1600);
    expect(fog.far).toBeGreaterThan(820); // clearer than the PS2 fogFar
  });

  it('casts sun shadows on HD (sized camera) and none on Low', () => {
    const make = () => ({
      castShadow: false,
      shadow: {
        mapSize: { set(_w: number, _h: number) {} },
        camera: { near: 0, far: 0, left: 0, right: 0, top: 0, bottom: 0, updateProjectionMatrix() {} },
        bias: 0, normalBias: 0,
      },
    });
    const hd = make();
    configureSunShadows(hd as unknown as DirectionalLight, 'hd', 200);
    expect(hd.castShadow).toBe(true);
    expect(hd.shadow.camera.right).toBe(200);
    expect(hd.shadow.camera.left).toBe(-200);

    const low = make();
    configureSunShadows(low as unknown as DirectionalLight, 'low');
    expect(low.castShadow).toBe(false);
  });
});
