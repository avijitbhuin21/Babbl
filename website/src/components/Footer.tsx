import React from "react";
import { Link } from "react-router-dom";
import { Container } from "./Container";
import { GITHUB_URL, RELEASES_URL } from "../lib/site";

const columns: {
  title: string;
  links: { label: string; href?: string; to?: string; external?: boolean }[];
}[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "Download", to: "/download" },
      { label: "Changelog", to: "/changelog" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Docs", to: "/docs" },
      { label: "GitHub", href: GITHUB_URL, external: true },
      { label: "Releases", href: RELEASES_URL, external: true },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", to: "/privacy" },
      { label: "Terms", to: "/terms" },
      { label: "MIT Licence", href: `${GITHUB_URL}/blob/main/LICENSE`, external: true },
    ],
  },
];

export const Footer: React.FC = () => (
  <footer className="border-t border-border/40">
    <Container className="grid gap-10 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
      <div>
        <div className="flex items-center">
          <img
            src="/babbl-wordmark.png"
            alt="Babbl"
            className="h-7 w-auto text-[15px] font-semibold tracking-tight"
          />
        </div>
        <p className="mt-3 max-w-[26ch] text-sm leading-relaxed text-text/45">
          Local-first dictation for people who would rather talk than type.
        </p>
      </div>

      {columns.map((column) => (
        <div key={column.title}>
          <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-text/35">
            {column.title}
          </h3>
          <ul className="mt-4 space-y-2.5">
            {column.links.map((link) => (
              <li key={link.label}>
                {link.to ? (
                  <Link
                    to={link.to}
                    className="text-sm text-text/60 transition-colors duration-200 hover:text-text"
                  >
                    {link.label}
                  </Link>
                ) : (
                  <a
                    href={link.href}
                    className="text-sm text-text/60 transition-colors duration-200 hover:text-text"
                    {...(link.external ? { target: "_blank", rel: "noreferrer" } : {})}
                  >
                    {link.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Container>

    <Container className="flex flex-col gap-2 border-t border-border/30 py-6 text-xs text-text/35 sm:flex-row sm:items-center sm:justify-between">
      <span>© {new Date().getFullYear()} Babbl. Open source under MIT.</span>
      <span>Built with Rust and Tauri.</span>
    </Container>
  </footer>
);
