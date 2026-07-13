// Monaco editor, bundled locally (no CDN loader — CSP stays default-src 'self').
//
// Only the base editor worker is wired up: syntax highlighting runs in the
// main thread (monarch tokenizers), language services (TS diagnostics etc.)
// are intentionally not loaded. Requires `worker-src 'self' blob:` in the CSP.

import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export default monaco;
