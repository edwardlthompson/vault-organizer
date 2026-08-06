import esbuild from "esbuild";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ortWeb = require.resolve("onnxruntime-web");
console.log("ortWeb", ortWeb);

const r = await esbuild.build({
  stdin: {
    contents: `
      import * as n from "onnxruntime-node";
      import * as w from "onnxruntime-web";
      export const same = n === w;
      export const nKeys = Object.keys(n).slice(0, 20);
      export const hasSession = !!(n.InferenceSession || n.default?.InferenceSession);
    `,
    resolveDir: process.cwd(),
    sourcefile: "alias-test.js",
  },
  bundle: true,
  write: false,
  format: "cjs",
  platform: "neutral",
  alias: { "onnxruntime-node": ortWeb },
  logLevel: "info",
  metafile: true,
});

const text = r.outputFiles[0].text;
console.log("bundle bytes", text.length);
console.log("has ?2ce3", text.includes("?2ce3"));
console.log("onnxruntime-node string", text.includes("onnxruntime-node"));
console.log("snippet:", text.slice(0, 400));

const inputs = Object.keys(r.metafile.inputs).filter((k) => /onnx/i.test(k));
console.log("onnx inputs:\n" + inputs.join("\n"));
