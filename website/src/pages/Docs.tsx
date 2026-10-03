import React from "react";
import { Container } from "../components/Container";
import { PageHeader } from "../components/PageHeader";
import { Prose } from "../components/Prose";
import { Reveal } from "../components/Reveal";
import { GITHUB_URL, LATEST_RELEASE_URL } from "../lib/site";

const sections = [
  { id: "install", label: "Install" },
  { id: "first-run", label: "First run" },
  { id: "shortcut", label: "Shortcut" },
  { id: "models", label: "Models" },
  { id: "live-text", label: "Live text" },
  { id: "post-processing", label: "Post-processing" },
  { id: "refine", label: "Refine" },
  { id: "sync", label: "Sync" },
  { id: "history", label: "History" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const Docs: React.FC = () => (
  <>
    <PageHeader
      eyebrow="Docs"
      title="Getting started"
      description="Everything you need to go from download to dictating, in about two minutes."
    />

    <Container className="grid gap-14 py-16 md:grid-cols-[180px_1fr] md:py-20">
      <nav className="hidden md:block">
        <div className="sticky top-24 space-y-2">
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="block text-sm text-text/45 transition-colors duration-200 hover:text-text"
            >
              {section.label}
            </a>
          ))}
        </div>
      </nav>

      <Reveal>
        <Prose>
          <h2 id="install">Install</h2>
          <p>
            Grab the installer for your platform from the{" "}
            <a href={LATEST_RELEASE_URL} target="_blank" rel="noreferrer">
              latest release
            </a>
            . On Windows run the <code>.exe</code>; on macOS drag the app into Applications; on
            Linux use the AppImage, <code>.deb</code> or <code>.rpm</code>.
          </p>
          <p>
            macOS asks for microphone and accessibility permission the first time you dictate.
            Babbl needs accessibility to place text into other applications.
          </p>

          <h2 id="first-run">First run</h2>
          <p>
            Onboarding asks you to pick a speech model and download it. Smaller models start
            instantly and are good enough for notes; larger ones are noticeably more accurate on
            names, punctuation and accents.
          </p>

          <h2 id="shortcut">Shortcut</h2>
          <p>
            The default shortcut is set during onboarding and can be changed under{" "}
            <code>General → Shortcut</code>. Two modes are available:
          </p>
          <ul>
            <li>
              <strong>Push to talk</strong>: hold the keys, speak, release to transcribe.
            </li>
            <li>
              <strong>Toggle</strong>: press once to start, press again to stop.
            </li>
          </ul>
          <p>
            A small overlay shows the input level while recording so you always know whether Babbl
            is listening. It can be switched off in settings.
          </p>

          <h2 id="models">Models</h2>
          <p>
            All local models run on Babbl's built-in GGUF engine. The catalogue includes Whisper,
            Parakeet, Moonshine, Qwen3-ASR, Canary, Voxtral, Granite Speech, SenseVoice and more.
            Each model card shows its size, languages, and whether it supports live text or
            translation.
          </p>
          <p>
            Models are stored on disk and load when needed. If you set an unload timeout, Babbl
            frees the memory after a period of inactivity and reloads the model next time you
            dictate.
          </p>

          <h3>GPU acceleration</h3>
          <p>
            Under <code>Advanced</code>, <em>GPU acceleration</em> runs models on your graphics card,
            through Vulkan on Windows and Linux or Metal on macOS. If no compatible GPU is found,
            Babbl uses the CPU instead.
          </p>

          <h3>Cloud models</h3>
          <p>
            If you'd rather have speed than keep everything local, turn on <code>Cloud models</code>{" "}
            to transcribe with a hosted provider using your own API key. This is off by default.
          </p>

          <h3>Languages</h3>
          <p>
            Pick a language explicitly or leave it on auto-detect. On models that support it,{" "}
            <em>Translate to English</em> transcribes any supported language directly into English.
          </p>

          <h2 id="live-text">Live text</h2>
          <p>
            Models marked <em>Live</em> can stream. Turn on <em>Live text while speaking</em> and
            the overlay shows your words as you talk. When you stop, the final transcript is
            pasted.
          </p>

          <h2 id="post-processing">Post-processing</h2>
          <p>
            Enable post-processing to pass the raw transcript through a language model before it is
            pasted. Typical uses are fixing punctuation, removing filler words or setting a tone.
            You can edit the prompts and bring your own provider and API key. On Apple silicon
            Macs running macOS 26 or later, Apple Intelligence runs it fully on-device.
          </p>

          <h3>Custom words</h3>
          <p>
            Add names, product terms or jargon under <code>Advanced → Custom words</code>. Babbl
            corrects close matches in the transcript, so words you use often come out right.
          </p>

          <h2 id="refine">Refine</h2>
          <p>
            Select text in any app, hold the refine shortcut and say what you want changed, for
            example "shorten this" or "make it more formal". Babbl rewrites the selection with the
            model you choose under <code>Cloud models → Refine</code> and pastes it back in place.
            The refine shortcut can be the same key as dictation or a separate one.
          </p>

          <h2 id="sync">Sync</h2>
          <p>
            The <code>Sync</code> section connects your computers. Give each one a name, then add a
            machine with a short PIN. On the same network it is found automatically; across the
            internet the connection goes through a relay. Once paired:
          </p>
          <ul>
            <li>
              <strong>Clipboard</strong>: copied text and images appear on your other machines. You
              can turn this off for each device.
            </li>
            <li>
              <strong>Files</strong>: open a machine and drop files onto it. There is no size
              limit. Received files go into Babbl's storage folder, and each machine shows a list
              of everything sent and received.
            </li>
          </ul>
          <p>
            Everything is encrypted end to end with XChaCha20-Poly1305, using a key agreed during
            PIN pairing. The relay only ever sees encrypted data.
          </p>

          <h2 id="history">History</h2>
          <p>
            Every transcription is saved locally with its audio, for as long as you choose to keep
            it. Transcription history is never synced. Clearing history deletes both the text and
            the recordings.
          </p>

          <h2 id="troubleshooting">Troubleshooting</h2>
          <ul>
            <li>
              <strong>Nothing is typed</strong>: check the paste method under{" "}
              <code>Advanced</code>, and confirm accessibility permission on macOS.
            </li>
            <li>
              <strong>No audio detected</strong>: select the correct input device in{" "}
              <code>General</code> and confirm the level meter moves while you speak.
            </li>
            <li>
              <strong>Slow transcription</strong>: turn on GPU acceleration, try a smaller model or
              use a cloud provider.
            </li>
            <li>
              <strong>Machines don't see each other</strong>: some networks block local discovery,
              such as Windows "Public" networks or phone hotspots. Pair using the IP address and
              port shown in the Add machine dialog, or use the Internet tab.
            </li>
          </ul>
          <p>
            Still stuck? Open an issue on{" "}
            <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer">
              GitHub
            </a>{" "}
            with your logs from <code>Debug → Log directory</code>.
          </p>
        </Prose>
      </Reveal>
    </Container>
  </>
);

export default Docs;
