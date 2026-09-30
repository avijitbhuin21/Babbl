import React from "react";
import { Plus } from "lucide-react";
import { Container } from "../components/Container";
import { Reveal } from "../components/Reveal";
import { FAQS } from "../lib/site";

export const Faq: React.FC = () => (
  <section id="faq" className="border-t border-border/40 py-20 md:py-28">
    <Container className="grid gap-12 md:grid-cols-[0.8fr_1.2fr]">
      <Reveal>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent/80">FAQ</p>
        <h2 className="mt-4 text-[30px] font-semibold leading-tight tracking-[-0.02em] md:text-[38px]">
          Questions.
        </h2>
      </Reveal>

      <div className="divide-y divide-border/40 border-y border-border/40">
        {FAQS.map((faq, i) => (
          <Reveal key={faq.q} delay={i * 50}>
            <details className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[15px] font-medium tracking-tight text-text/85 transition-colors duration-200 hover:text-text">
                {faq.q}
                <Plus
                  size={15}
                  className="shrink-0 text-text/35 transition-transform duration-200 group-open:rotate-45"
                />
              </summary>
              <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-text/50">{faq.a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </Container>
  </section>
);
