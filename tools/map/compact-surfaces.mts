import { convertSurfaceMap } from './src/pipeline/compactSurfaceRecipe';
await convertSurfaceMap(...process.argv.slice(2, 5) as [string | undefined, string | undefined, string | undefined]);
