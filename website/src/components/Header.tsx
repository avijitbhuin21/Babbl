import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Container } from "./Container";
import { Action } from "./Action";
import { GITHUB_URL, NAV_LINKS, DOWNLOAD_PATH } from "../lib/site";

export const Header: React.FC = () => {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [location]);

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors duration-200 ${
        scrolled
          ? "border-border/40 bg-background/85 backdrop-blur-md"
          : "border-transparent bg-background"
      }`}
    >
      <Container className="flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center">
          <img
            src="/babbl-wordmark.png"
            alt="Babbl"
            className="h-8 w-auto text-[15px] font-semibold tracking-tight"
          />
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-text/60 transition-colors duration-200 hover:text-text"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-text/60 transition-colors duration-200 hover:text-text"
          >
            GitHub
          </a>
          <Action to={DOWNLOAD_PATH}>Download</Action>
        </div>

        <button
          className="text-text/70 transition-colors hover:text-text md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </Container>

      {open && (
        <div className="border-t border-border/40 bg-background md:hidden">
          <Container className="flex flex-col gap-1 py-4">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md px-1 py-2 text-sm text-text/70 transition-colors hover:text-text"
              >
                {link.label}
              </a>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-1 py-2 text-sm text-text/70 transition-colors hover:text-text"
            >
              GitHub
            </a>
            <Action to={DOWNLOAD_PATH} className="mt-2 w-full">
              Download
            </Action>
          </Container>
        </div>
      )}
    </header>
  );
};
