import type { Material } from 'three';
import { flags } from '@gtasf/shared/flags';

/**
 * avatarNightFill (lane D, QA P1 gtasf-f2jj8): people are plain Lambert lit only by the scene lights, which at night are a
 * dim moon + ambient. Cars read through their env reflections and buildings/roads have night emissive fills, but the
 * dark-clothed Meshy bodies (and their VAT crowd) went to near-black silhouettes. This adds a night fill that follows the
 * shared night level (0 day .. 1 night), like the roads' uRoadNight: an albedo-INDEPENDENT cool base (so black clothing
 * still reads as a lit figure, not a cut-out) plus an albedo-proportional term that keeps colour and skin tone.
 */
export const characterNight = { value: 0 };
const BASE = 'vec3(0.05, 0.055, 0.07)', LIFT = 0.45;

/** Patch a character material (Lambert/Phong/Standard with an emissive stage) with the night lift. Idempotent. */
export function addCharacterNightFill(material: Material): void {
  if (!flags.avatarNightFill || material.userData.characterNight) return;
  material.userData.characterNight = true;
  const prepare = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${key}:character-night-v2`;
  material.onBeforeCompile = (shader, renderer) => {
    prepare.call(material, shader, renderer);
    shader.uniforms.uCharacterNight = characterNight;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCharacterNight;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += (${BASE} + diffuseColor.rgb * ${LIFT.toFixed(2)}) * uCharacterNight;`);
  };
}
