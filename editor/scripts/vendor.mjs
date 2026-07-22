import { copyFile, mkdir } from "node:fs/promises";

await mkdir(new URL("../public/vendor/", import.meta.url), { recursive: true });
await Promise.all([
  copyFile(new URL("../node_modules/marked/lib/marked.umd.js", import.meta.url), new URL("../public/vendor/marked.js", import.meta.url)),
  copyFile(new URL("../node_modules/dompurify/dist/purify.min.js", import.meta.url), new URL("../public/vendor/purify.min.js", import.meta.url)),
]);
