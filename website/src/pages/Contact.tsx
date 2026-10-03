import React from "react";
import { Bug, Mail } from "lucide-react";
import { Container } from "../components/Container";
import { PageHeader } from "../components/PageHeader";
import { Reveal } from "../components/Reveal";
import { Action } from "../components/Action";
import { CONTACT_EMAIL, GITHUB_URL } from "../lib/site";

const Contact: React.FC = () => (
  <>
    <PageHeader
      eyebrow="Contact"
      title="Get in touch"
      description="Questions, feedback, partnership ideas or anything else. We read every message."
    />

    <Container className="py-16 md:py-20">
      <div className="grid gap-px overflow-hidden rounded-xl border border-border/40 bg-border/40 md:grid-cols-2">
        <Reveal>
          <div className="flex h-full flex-col bg-background p-7 md:p-9">
            <Mail size={18} className="text-accent" />
            <h2 className="mt-5 text-[17px] font-medium tracking-tight">Email</h2>
            <p className="mt-2.5 text-sm leading-relaxed text-text/50">
              For general questions, feedback or anything private, email us directly.
            </p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="mt-5 text-[15px] text-accent underline-offset-4 hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
            <div className="mt-auto pt-7">
              <Action href={`mailto:${CONTACT_EMAIL}`}>Send an email</Action>
            </div>
          </div>
        </Reveal>

        <Reveal delay={60}>
          <div className="flex h-full flex-col bg-background p-7 md:p-9">
            <Bug size={18} className="text-accent" />
            <h2 className="mt-5 text-[17px] font-medium tracking-tight">Bugs and feature requests</h2>
            <p className="mt-2.5 text-sm leading-relaxed text-text/50">
              Found a bug or have an idea? Open an issue on GitHub so others can follow along.
              Attaching your logs from <code>Debug → Log directory</code> helps a lot.
            </p>
            <div className="mt-auto pt-7">
              <Action href={`${GITHUB_URL}/issues`} external variant="secondary">
                Open an issue
              </Action>
            </div>
          </div>
        </Reveal>
      </div>
    </Container>
  </>
);

export default Contact;
