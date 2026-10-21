// Serve existing one-shot web/Worker bundles. No dev server, watcher or implicit build.
import { startPreview } from '../../tools/preview.mjs';
const preview = await startPreview();
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (closing) return;
  closing = true; await preview.close(); process.exit(0);
});
console.log(`Test preview: ${preview.url}`);
