import { TextureLoader, type Texture } from 'three';

/** Optional scenery must settle during boot; discard image completions after the deadline. */
export function loadSceneryTexture(path: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    let waiting = true;
    const timeout = setTimeout(() => {
      waiting = false;
      reject(new Error(`Scenery texture timed out: ${path}`));
    }, 15_000);
    new TextureLoader().loadAsync(path).then(value => {
      if (!waiting) { value.dispose(); return; }
      waiting = false; clearTimeout(timeout); resolve(value);
    }, error => { waiting = false; clearTimeout(timeout); reject(error); });
  });
}
