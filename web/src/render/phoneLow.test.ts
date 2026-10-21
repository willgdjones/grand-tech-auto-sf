import { expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene, Vector3, type ShaderMaterial, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { createPost } from './post';
import { createRealisticPost } from './realisticPost';


it('realistic low renders directly with chase/cinematic cameras and allocates no composer', () => {
  const renderer = { render: vi.fn() } as unknown as WebGLRenderer;
  const scene = new Scene(), chase = new PerspectiveCamera(), cinematic = new PerspectiveCamera();
  const post = createRealisticPost({ renderer, scene, camera: chase, preset: 'low', width: 600, height: 1200 });
  expect(post.composer).toBeNull();
  post.render(); post.setSize(300, 600); post.render(cinematic);
  expect(renderer.render).toHaveBeenNthCalledWith(1, scene, chase);
  expect(renderer.render).toHaveBeenNthCalledWith(2, scene, cinematic);
  post.dispose(); post.render();
  expect(renderer.render).toHaveBeenCalledTimes(2);
});
