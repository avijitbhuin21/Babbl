import React from "react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Container } from "../components/Container";
import { Reveal } from "../components/Reveal";
import { PLATFORMS, RELEASES_URL } from "../lib/site";

export const Download: React.FC = () => (
  <section id="download" className="border-t border-border/40 py-20 md:py-28">
    <Container>
      <Reveal className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent/80">Download</p>
          <h2 className="mt-4 text-[30px] font-semibold leading-tight tracking-[-0.02em] md:text-[38px]">
            Free, forever.
          </h2>
        </div>
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-text/50 transition-colors duration-200 hover:text-text"
        >
          All releases
          <ArrowUpRight size={14} />
        </a>
      </Reveal>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {PLATFORMS.map((platform, i) => (
          <Reveal key={platform.name} delay={i * 60}>
            <Link
              to={platform.href}
              className="group flex h-full flex-col justify-between rounded-xl border border-border/40 bg-surface/30 p-6 transition-colors duration-200 hover:border-accent/40 hover:bg-surface/60"
            >
              <div>
                <h3 className="text-[15px] font-medium tracking-tight">{platform.name}</h3>
                <p className="mt-2 text-sm text-text/45">{platform.detail}</p>
              </div>
              <span className="mt-8 inline-flex items-center gap-1.5 text-sm text-accent">
                Get the installer
                <ArrowUpRight
                  size={14}
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                />
              </span>
            </Link>
          </Reveal>
        ))}
      </div>
    </Container>
  </section>
);
