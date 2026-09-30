import React from "react";
import { Container } from "../components/Container";
import { PageHeader } from "../components/PageHeader";
import { Prose } from "../components/Prose";
import { Reveal } from "../components/Reveal";
import { GITHUB_URL } from "../lib/site";

const Privacy: React.FC = () => (
  <>
    <PageHeader
      eyebrow="Legal"
      title="Privacy"
      description="Short version: Babbl runs on your computer and we do not collect anything."
    />

    <Container className="py-16 md:py-20">
      <Reveal>
        <Prose>
          <h2>What we collect</h2>
          <p>
            Nothing. Babbl has no accounts, no analytics and no telemetry. This website sets no
            tracking cookies.
          </p>

          <h2>Where your data lives</h2>
          <p>
            Recordings, transcripts, settings and downloaded models are stored in the application
            data directory on your own machine. You can open that folder from{" "}
            <code>Debug → App data directory</code> and delete anything at any time.
          </p>

          <h2>Network requests</h2>
          <ul>
            <li>Downloading a speech model, when you choose one.</li>
            <li>Checking for application updates, which you can disable in settings.</li>
            <li>
              Requests to a cloud model provider, only if you enable that feature and supply your
              own API key. In that case your transcript is sent to that provider under their terms,
              not ours.
            </li>
          </ul>

          <h2>Third parties</h2>
          <p>
            Installers are hosted on GitHub, and the changelog on this site reads the public GitHub
            releases API. Their own privacy policies apply to those requests.
          </p>

          <h2>Contact</h2>
          <p>
            Questions or concerns can be raised as an issue on{" "}
            <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer">
              GitHub
            </a>
            .
          </p>
        </Prose>
      </Reveal>
    </Container>
  </>
);

export default Privacy;
