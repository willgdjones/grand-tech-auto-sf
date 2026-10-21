import { compactRoadPoints } from './src/pipeline/compactRoadPoints';
await compactRoadPoints(...process.argv.slice(2, 5) as [string | undefined, string | undefined, string | undefined]);
