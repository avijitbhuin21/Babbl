import React from "react";
import { Container } from "../components/Container";
import { Reveal } from "../components/Reveal";
import { STEPS } from "../lib/site";

export const HowItWorks: React.FC = () => (
  <section id="how-it-works" className="border-t border-border/40 py-20 md:py-28">
    <Container>
      <Reveal>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent/80">
          How it works
        </p>
        <h2 className="mt-4 max-w-[20ch] text-[30px] font-semibold leading-tight tracking-[-0.02em] md:text-[38px]">
          Three steps, then you forget it's there.
        </h2>
      </Reveal>

      <div className="mt-14 grid gap-10 md:grid-cols-3 md:gap-12">
        {STEPS.map((step, i) => (
          <Reveal key={step.title} delay={i * 80}>
            <div className="border-t border-border/50 pt-6">
              <span className="text-xs tabular-nums text-accent/70">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-4 text-[17px] font-medium tracking-tight">{step.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-text/50">{step.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Container>
  </section>
);
