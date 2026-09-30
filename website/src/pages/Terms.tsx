import React from "react";
import { Container } from "../components/Container";
import { PageHeader } from "../components/PageHeader";
import { Prose } from "../components/Prose";
import { Reveal } from "../components/Reveal";
import { GITHUB_URL } from "../lib/site";

const Terms: React.FC = () => (
  <>
    <PageHeader
      eyebrow="Legal"
      title="Terms"
      description="Babbl is free, open source software provided as is."
    />

    <Container className="py-16 md:py-20">
      <Reveal>
        <Prose>
          <h2>Licence</h2>
          <p>
            Babbl is released under the MIT licence. You may use, copy, modify and distribute it,
            including commercially, provided the copyright notice and licence text are kept. The
            full text lives in the{" "}
            <a href={`${GITHUB_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
              repository
            </a>
            .
          </p>

          <h2>No warranty</h2>
          <p>
            The software is provided without warranty of any kind. Transcription is imperfect by
            nature and you are responsible for reviewing the text it produces before relying on it.
          </p>

          <h2>Acceptable use</h2>
          <p>
            You are responsible for complying with the laws that apply to you, including consent
            requirements for recording other people, and for the terms of any third-party model
            provider you configure.
          </p>

          <h2>Changes</h2>
          <p>
            These terms may change as the project evolves. Continued use of the software after a
            change means you accept the revised terms.
          </p>
        </Prose>
      </Reveal>
    </Container>
  </>
);

export default Terms;
