import React from "react";
import { Container } from "./Container";
import { Reveal } from "./Reveal";

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ eyebrow, title, description }) => (
  <section className="border-b border-border/40">
    <Container className="py-16 md:py-20">
      <Reveal>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent/80">{eyebrow}</p>
        <h1 className="mt-4 text-[34px] font-semibold leading-tight tracking-[-0.03em] md:text-[44px]">
          {title}
        </h1>
        {description && (
          <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-text/50">
            {description}
          </p>
        )}
      </Reveal>
    </Container>
  </section>
);
