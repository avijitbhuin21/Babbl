import React from "react";
import {
  Boxes,
  Cloud,
  Cpu,
  Gauge,
  History,
  Keyboard,
  Languages,
  MonitorSmartphone,
  Radio,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Container } from "../components/Container";
import { Reveal } from "../components/Reveal";
import { FEATURES } from "../lib/site";

const ICONS = {
  Boxes,
  Cloud,
  Cpu,
  Gauge,
  History,
  Keyboard,
  Languages,
  MonitorSmartphone,
  Radio,
  ShieldCheck,
  Sparkles,
  Wand2,
};

export const Features: React.FC = () => (
  <section id="features" className="border-t border-border/40 py-20 md:py-28">
    <Container>
      <Reveal>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent/80">Features</p>
        <h2 className="mt-4 max-w-[20ch] text-[30px] font-semibold leading-tight tracking-[-0.02em] md:text-[38px]">
          Everything it needs. Nothing it doesn't.
        </h2>
      </Reveal>

      <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-border/40 bg-border/40 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, i) => {
          const Icon = ICONS[feature.icon as keyof typeof ICONS];

          return (
            <Reveal key={feature.title} delay={(i % 3) * 60}>
              <div className="h-full bg-background p-7 transition-colors duration-200 hover:bg-surface/40">
                {Icon && <Icon size={18} className="text-accent" />}
                <h3 className="mt-5 text-[15px] font-medium tracking-tight">{feature.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-text/50">{feature.body}</p>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Container>
  </section>
);
