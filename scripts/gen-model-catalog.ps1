# Regenerates src-tauri/src/managers/catalog.rs from transcribe.cpp's model catalog and prints the
# matching `MODELS` entries for website/mirror.mjs.
# Usage: pwsh scripts/gen-model-catalog.ps1 -CatalogJson path/to/catalog.json
#   (catalog.json: Handy repo, src-tauri/src/catalog/catalog.json)
param([Parameter(Mandatory = $true)][string]$CatalogJson)
$ErrorActionPreference = 'Stop'
$j = Get-Content $CatalogJson -Raw | ConvertFrom-Json
# slug, display name, description, live-first ordering
$pick = @(
  @('parakeet-unified-en-0.6b','Parakeet Live (English)','Live text as you speak. Fast and very accurate English.'),
  @('nemotron-3.5-asr-streaming-0.6b','Nemotron Live (Multilingual)','Live text as you speak. 28 languages.'),
  @('moonshine-streaming-tiny','Moonshine Live Tiny','Live text, tiny and ultra-fast. English only. Good for slow machines.'),
  @('moonshine-streaming-small','Moonshine Live Small','Live text, very fast. English only.'),
  @('moonshine-streaming-medium','Moonshine Live Medium','Live text, fast and accurate. English only.'),
  @('Voxtral-Mini-4B-Realtime-2602','Voxtral Realtime','Live text, 13 languages. Large; needs a strong GPU.'),
  @('Qwen3-ASR-1.7B','Qwen3-ASR 1.7B','Top accuracy. 30 languages incl. Chinese dialects. Best with a GPU.'),
  @('Qwen3-ASR-0.6B','Qwen3-ASR 0.6B','Very accurate and lighter. 30 languages.'),
  @('whisper-large-v3-turbo','Whisper Turbo','Accurate, 99 languages. Best with a GPU.'),
  @('whisper-small','Whisper Small','Fast and fairly accurate. 99 languages. Can translate to English.'),
  @('parakeet-tdt-0.6b-v2','Parakeet V2','English only. Fast and very accurate.'),
  @('parakeet-tdt-0.6b-v3','Parakeet V3','Fast and accurate. 25 European languages, auto-detected.'),
  @('canary-1b-v2','Canary 1B v2','Accurate. 25 European languages + translation to English.'),
  @('canary-180m-flash','Canary Flash','Tiny and very fast. English, German, Spanish, French + translation.'),
  @('cohere-transcribe-03-2026','Cohere Transcribe','Very accurate. 14 languages incl. Chinese, Japanese, Korean.'),
  @('granite-speech-4.1-2b','Granite Speech 4.1','Very accurate. 6 languages + translation. Large; best with a GPU.'),
  @('Fun-ASR-MLT-Nano-2512','Fun-ASR Nano','Accurate. 31 languages, strong on Asian languages.'),
  @('SenseVoiceSmall','SenseVoice','Very fast. Chinese, Cantonese, English, Japanese, Korean.'),
  @('gigaam-v3-e2e-ctc','GigaAM v3','Best for Russian. Fast, with punctuation.')
)
function q($s) { '"' + ($s -replace '\\','\\' -replace '"','\"') + '"' }
$out = New-Object System.Collections.Generic.List[string]
$out.Add('// Generated from the transcribe.cpp model catalog (Handy v0.9.7 catalog.json). Do not edit by hand;')
$out.Add('// regenerate with scripts/gen-model-catalog.ps1 so sizes and hashes stay exact.')
$out.Add('')
$out.Add('/// One downloadable GGUF model. `upstream` is the Hugging Face source the bucket mirror copies from.')
$out.Add('pub struct CatalogEntry {')
$out.Add('    pub id: &''static str,')
$out.Add('    pub name: &''static str,')
$out.Add('    pub description: &''static str,')
$out.Add('    pub filename: &''static str,')
$out.Add('    pub size_bytes: u64,')
$out.Add('    pub sha256: &''static str,')
$out.Add('    #[allow(dead_code)] // used by tests and the website mirror list')
$out.Add('    pub upstream: &''static str,')
$out.Add('    pub streaming: bool,')
$out.Add('    pub translate: bool,')
$out.Add('    pub language_detect: bool,')
$out.Add('    pub languages: &''static [&''static str],')
$out.Add('    pub accuracy: f32,')
$out.Add('    pub speed: f32,')
$out.Add('}')
$out.Add('')
$out.Add('pub const CATALOG: &[CatalogEntry] = &[')
$mirror = New-Object System.Collections.Generic.List[string]
foreach ($p in $pick) {
  $m = $j.models | ? slug -eq $p[0]
  if (-not $m) { throw "missing $($p[0])" }
  $f = $m.files | ? quant -eq $m.default_quant | Select -First 1
  $up = "https://huggingface.co/$($m.id)/resolve/$($m.revision)/$($f.filename)"
  $langs = ($m.languages | % { q $_ }) -join ', '
  $out.Add('    CatalogEntry {')
  $out.Add("        id: $(q $m.slug),")
  $out.Add("        name: $(q $p[1]),")
  $out.Add("        description: $(q $p[2]),")
  $out.Add("        filename: $(q $f.filename),")
  $out.Add("        size_bytes: $($f.size_bytes),")
  $out.Add("        sha256: $(q $f.sha256),")
  $out.Add("        upstream: $(q $up),")
  $out.Add("        streaming: $($m.capabilities.streaming.ToString().ToLower()),")
  $out.Add("        translate: $($m.capabilities.translate.ToString().ToLower()),")
  $out.Add("        language_detect: $([bool]$m.capabilities.lang_detect | % { $_.ToString().ToLower() }),")
  $out.Add("        languages: &[$langs],")
  $out.Add("        accuracy: $(($m.accuracy_score / 100).ToString('0.00', [Globalization.CultureInfo]::InvariantCulture)),")
  $out.Add("        speed: $(($m.speed_score / 100).ToString('0.00', [Globalization.CultureInfo]::InvariantCulture)),")
  $out.Add('    },')
  $mirror.Add("  { file: '$($f.filename)', url: '$up', size: $($f.size_bytes), sha256: '$($f.sha256)' },")
}
$out.Add('];')
[IO.File]::WriteAllLines("$PSScriptRoot/../src-tauri/src/managers/catalog.rs", $out)
"Wrote catalog.rs ($($pick.Count) models). website/mirror.mjs MODELS entries:"
$mirror
