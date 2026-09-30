// Shared model-mirroring logic: copies upstream model files into the bucket under models/<file>.
// The list mirrors src-tauri/src/managers/catalog.rs (pinned Hugging Face revisions + SHA-256).
import { createHash } from "node:crypto";
import { presign, uploadStream } from "./s3.mjs";

export const MODELS = [
  { file: 'parakeet-unified-en-0.6b-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf/resolve/7e948f21b7bdbac698d3318db9d350f1096f3b6c/parakeet-unified-en-0.6b-Q8_0.gguf', size: 731357568, sha256: '4b50b6dd862bf6e346929aaf4f5eaacec003bfa3f56462d6c874b41ef2f38795' },
  { file: 'nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/resolve/6d44e540bc31b0de1dbe174a3cea87f53a7f22fb/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf', size: 751094240, sha256: 'b94545b313b3223fda7b2857a52681da813935c2127643d1e9ff0c23d988089c' },
  { file: 'moonshine-streaming-tiny-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/moonshine-streaming-tiny-gguf/resolve/85ddff612fa3a2cf40b2f745abcfa90ef82f293b/moonshine-streaming-tiny-Q8_0.gguf', size: 50462816, sha256: '930e4622ad3a24158b91406c30c977fa6a26b34cb32d6ac3e57cfb23383a869e' },
  { file: 'moonshine-streaming-small-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/moonshine-streaming-small-gguf/resolve/41444173ed8210852a883e046fadcfba3e7bfbae/moonshine-streaming-small-Q8_0.gguf', size: 198506848, sha256: 'd03670f69629b649085d0f44a63d97668b4119117cc9611a4e4ad94341713dfc' },
  { file: 'moonshine-streaming-medium-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/moonshine-streaming-medium-gguf/resolve/c722a9455a40a1844c3d25267dc84eff61d8dd84/moonshine-streaming-medium-Q8_0.gguf', size: 295793568, sha256: 'f7c9564249b508f6012927ec4f9e536087da53a7047f858ca9975bea5f75299e' },
  { file: 'Voxtral-Mini-4B-Realtime-2602-Q5_K_M.gguf', url: 'https://huggingface.co/handy-computer/Voxtral-Mini-4B-Realtime-2602-gguf/resolve/b3e1c979e3775cbd0a49a65878a0ec7f06789ed7/Voxtral-Mini-4B-Realtime-2602-Q5_K_M.gguf', size: 3281439008, sha256: 'e20a7582c5cf8159454c909b7f57b184b287cb3d7c3ec85744727a2cec51b08f' },
  { file: 'Qwen3-ASR-1.7B-Q5_K_M.gguf', url: 'https://huggingface.co/handy-computer/Qwen3-ASR-1.7B-gguf/resolve/92282af1610a2db19d66f2bef1e260f5deca782d/Qwen3-ASR-1.7B-Q5_K_M.gguf', size: 1517290464, sha256: '034c557fe92ff8fcd9a9c041cbdaad347be0a86a58d3a348f63cf3f0180879d0' },
  { file: 'Qwen3-ASR-0.6B-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/Qwen3-ASR-0.6B-gguf/resolve/e4e16599b900eb0cb36e524514756bb92eb092b7/Qwen3-ASR-0.6B-Q8_0.gguf', size: 850423456, sha256: 'f081b2d5e23bd669d92cc331d722a8a0681943b8e6f34b48996fd5c319b5acd8' },
  { file: 'whisper-large-v3-turbo-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/whisper-large-v3-turbo-gguf/resolve/5eaf945c7978e564bae5b28a5b1639dd93c2bfb1/whisper-large-v3-turbo-Q8_0.gguf', size: 886381760, sha256: 'b2e30cc286bc9f3aba4db9099fc7403543497c05ce7100d0d83091ddfd25a183' },
  { file: 'whisper-small-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/whisper-small-gguf/resolve/c0214bd34be9296695486f838e0142f900803159/whisper-small-Q8_0.gguf', size: 269751136, sha256: '9b9c8811bbcc82a7766f0fb0925614bdacb0923b2cc630daeac17108b655b860' },
  { file: 'parakeet-tdt-0.6b-v2-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v2-gguf/resolve/07cee0616125a08ef619729bb47f40ef747e4bc4/parakeet-tdt-0.6b-v2-Q8_0.gguf', size: 729574912, sha256: 'f0d0e99cebb6d3b83f1f7069b82b5d3c2e39a54545b0da039cb4bafd9c4e5caa' },
  { file: 'parakeet-tdt-0.6b-v3-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/resolve/85ac09ea12fc4b1112fa76810059364bc6adc9de/parakeet-tdt-0.6b-v3-Q8_0.gguf', size: 739508576, sha256: '5859f77944efcd8eafa23a6350731960b2b55b2203df51f319665c807d802cc7' },
  { file: 'canary-1b-v2-Q5_K_M.gguf', url: 'https://huggingface.co/handy-computer/canary-1b-v2-gguf/resolve/58d13c2c0102229aad45f7e19a77ddc42b41dd9a/canary-1b-v2-Q5_K_M.gguf', size: 836664032, sha256: '9c3a893c93795438baf9b4b1c853c39b60316c3a0d259a3ba6e284712f5ddb71' },
  { file: 'canary-180m-flash-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/canary-180m-flash-gguf/resolve/b147f9dc52b59f0998e410540a84727bd86457fd/canary-180m-flash-Q8_0.gguf', size: 218447552, sha256: 'e13c7f5d0952b056a027cfffec13e3a3a134d1608babed24f983568f141e297c' },
  { file: 'cohere-transcribe-03-2026-Q5_K_M.gguf', url: 'https://huggingface.co/handy-computer/cohere-transcribe-03-2026-gguf/resolve/dfa4adebb64f3076b7b6b90b721275cc069cb421/cohere-transcribe-03-2026-Q5_K_M.gguf', size: 1770270208, sha256: '14d02f1ad6dd77b3a60f82639879012c3adb4fe25c50a5a47a2c4c661daf1558' },
  { file: 'granite-speech-4.1-2b-Q5_K_M.gguf', url: 'https://huggingface.co/handy-computer/granite-speech-4.1-2b-gguf/resolve/58e7710fd7039ded5a185668eef5f71ca5d9d919/granite-speech-4.1-2b-Q5_K_M.gguf', size: 1829704544, sha256: '63e0d3a82fa6f0f4688af0b7d7ee784864d271b7be820f4ea43c8298c59b0ac5' },
  { file: 'Fun-ASR-MLT-Nano-2512-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/Fun-ASR-MLT-Nano-2512-gguf/resolve/0b8f9c7bc545a219658aeb1dd4eeaa55d1cf89f3/Fun-ASR-MLT-Nano-2512-Q8_0.gguf', size: 891271232, sha256: 'd12476d8d9f2baa0ebf738fa955fa05ed33a654f1567289033a810c45d9d9002' },
  { file: 'SenseVoiceSmall-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/SenseVoiceSmall-gguf/resolve/4a08b8e900b38a977e32eb08d5d0697d6e72ba04/SenseVoiceSmall-Q8_0.gguf', size: 252684608, sha256: '6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29' },
  { file: 'gigaam-v3-e2e-ctc-Q8_0.gguf', url: 'https://huggingface.co/handy-computer/gigaam-v3-e2e-ctc-gguf/resolve/075dff81f843cf23d22b4ce943ffdc4dd8650cd7/gigaam-v3-e2e-ctc-Q8_0.gguf', size: 272151136, sha256: '9ccce4750dc813a493d96ca15ee251712bedec15ac9a02fa3d2bd732f08ae5eb' },
];

/** Mirrors `models` (default: all), skipping files already present with the right size; verifies SHA-256 in flight. */
export async function mirrorModels(cfg, models = MODELS, log = console.log) {
  let failures = 0;
  for (const m of models) {
    const mb = (n) => (n / 1048576).toFixed(0);
    try {
      const existing = await fetch(presign(cfg, `models/${m.file}`, { method: "HEAD" }), { method: "HEAD" });
      if (existing.ok && Number(existing.headers.get("content-length")) === m.size) {
        log(`${m.file}: already mirrored (${mb(m.size)} MB)`);
        continue;
      }
      const started = Date.now();
      const res = await fetch(m.url);
      if (!res.ok || !res.body) throw new Error(`upstream GET ${res.status}`);
      const hash = createHash("sha256");
      const hashed = res.body.pipeThrough(
        new TransformStream({
          transform(chunk, ctl) {
            hash.update(chunk);
            ctl.enqueue(chunk);
          },
        }),
      );
      let lastLog = 0;
      const sent = await uploadStream(cfg, `models/${m.file}`, hashed, (bytes) => {
        if (Date.now() - lastLog > 15000) {
          lastLog = Date.now();
          log(`  ${m.file}: ${mb(bytes)} / ${mb(m.size)} MB`);
        }
      });
      if (sent !== m.size) throw new Error(`size mismatch: sent ${sent}, expected ${m.size}`);
      const digest = hash.digest("hex");
      if (digest !== m.sha256) throw new Error(`checksum mismatch: ${digest}`);
      log(`${m.file}: mirrored ${mb(m.size)} MB in ${((Date.now() - started) / 1000).toFixed(0)}s (sha256 ok)`);
    } catch (e) {
      failures++;
      log(`${m.file}: FAILED ${e.message}`);
    }
  }
  log(failures ? `done with ${failures} failure(s)` : "done");
  return failures;
}
