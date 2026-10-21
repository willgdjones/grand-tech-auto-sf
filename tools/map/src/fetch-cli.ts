import { main } from './pipeline/cli';
/** Compatibility with pane 1's initial @gtasf/tools script; network access stays explicit. */
if(process.argv.includes('--fetch')) {
  await main(['fetch',...process.argv.slice(2).filter(arg=>arg!=='--fetch')]);
} else console.log('Explicit source fetch: npm --prefix tools/map run fetch -- --area lombard');
