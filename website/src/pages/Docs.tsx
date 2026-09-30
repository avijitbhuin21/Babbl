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
  { id: "post-processing", label: "Post-processing" },
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
            Models live on disk and load on demand. If you set an unload timeout, Babbl frees the
            memory after a period of inactivity and reloads on the next dictation. You can also
            point Babbl at a hosted provider under <code>Cloud models</code> if you prefer speed
            over locality. That is off by default.
          </p>

          <h3>Languages</h3>
          <p>
            Pick a language explicitly or leave it on auto-detect. <em>Translate to English</em>{" "}
            transcribes any supported language directly into English.
          </p>

          <h2 id="post-processing">Post-processing</h2>
          <p>
            Enable post-processing to pass the raw transcript through a language model before it is
            pasted. Typical uses are punctuation repair, removing filler words, or enforcing a
            tone. Prompts are editable, and you can bring your own provider and API key.
          </p>

          <h3>Custom words</h3>
          <p>
            Add names, product terms or jargon under <code>Advanced → Custom words</code>. Babbl
            corrects close matches in the transcript so recurring vocabulary stops being a problem.
          </p>

          <h2 id="history">History</h2>
          <p>
            Every transcription is saved locally with its audio, subject to the retention window
            you set. Nothing is synced. Clearing history deletes both the text and the recordings.
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
              <strong>Slow transcription</strong>: try a smaller model, or enable a cloud provider.
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
