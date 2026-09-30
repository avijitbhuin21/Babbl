import React, { useEffect, useState } from "react";
import { ArrowUpRight, Check, Download as DownloadIcon } from "lucide-react";
import { Container } from "../components/Container";
import { PageHeader } from "../components/PageHeader";
import { Reveal } from "../components/Reveal";
import { GITHUB_REPO, RELEASES_URL } from "../lib/site";
import {
  assetLabel,
  detectPlatform,
  formatSize,
  groupAssets,
  LatestRelease,
  PLATFORM_LABELS,
  PlatformId,
} from "../lib/releases";

const ORDER: PlatformId[] = ["windows", "macos", "linux"];

const DownloadPage: React.FC = () => {
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [failed, setFailed] = useState(false);
  const current = detectPlatform();

  useEffect(() => {
    fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then(setRelease)
      .catch(() => setFailed(true));
  }, []);

  const grouped = release ? groupAssets(release.assets) : null;

  const platforms = [...ORDER].sort((a, b) => {
    if (a === current) return -1;
    if (b === current) return 1;
    return 0;
  });

  return (
    <>
      <PageHeader
        eyebrow="Download"
        title="Get Babbl"
        description="Every build comes straight from the GitHub release for this version. Free, open source, no account needed."
      />

      <Container className="py-16 md:py-20">
        <Reveal className="flex flex-wrap items-center gap-3 text-sm text-text/45">
          {release && (
            <>
              <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-accent">
                {release.tag_name}
              </span>
              <span>
                Released{" "}
                {new Date(release.published_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </>
          )}
          {!release && !failed && <span className="text-text/35">Loading latest release…</span>}
          {failed && (
            <span>
              Couldn't reach GitHub.{" "}
              <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="text-accent">
                Open the releases page
              </a>
              .
            </span>
          )}
        </Reveal>

        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border/40 bg-border/40 md:grid-cols-3">
          {platforms.map((platform, i) => {
            const info = PLATFORM_LABELS[platform];
            const assets = grouped?.[platform] ?? [];

            return (
              <Reveal key={platform} delay={i * 60}>
                <div className="flex h-full flex-col bg-background p-7">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-[17px] font-medium tracking-tight">{info.name}</h2>
                    {platform === current && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                        <Check size={11} />
                        Your system
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-text/45">{info.requirement}</p>

                  <div className="mt-6 flex flex-1 flex-col gap-2">
                    {assets.map((asset) => (
                      <a
                        key={asset.id}
                        href={asset.browser_download_url}
                        className="group flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-surface/30 px-3.5 py-3 transition-colors duration-200 hover:border-accent/40 hover:bg-surface/60"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-text/85">
                            {assetLabel(asset.name)}
                          </span>
                          <span className="mt-0.5 block text-xs text-text/35">
                            {formatSize(asset.size)}
                          </span>
                        </span>
                        <DownloadIcon
                          size={15}
                          className="shrink-0 text-text/35 transition-colors duration-200 group-hover:text-accent"
                        />
                      </a>
                    ))}

                    {release && assets.length === 0 && (
                      <a
                        href={RELEASES_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-dashed border-border/50 px-3.5 py-3 text-sm text-text/40 transition-colors duration-200 hover:border-accent/40 hover:text-text/70"
                      >
                        No build in this release. Browse all releases.
                      </a>
                    )}

                    {!release && (
                      <>
                        <span className="h-[54px] rounded-lg border border-border/30 bg-surface/20" />
                        <span className="h-[54px] rounded-lg border border-border/30 bg-surface/20" />
                      </>
                    )}
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={120}>
          <div className="mt-10 flex flex-col gap-4 rounded-xl border border-border/40 bg-surface/20 p-7 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-[15px] font-medium tracking-tight">Looking for something else?</h2>
              <p className="mt-2 max-w-[60ch] text-sm text-text/45">
                Older versions, checksums and signatures for every build live on GitHub. Babbl also
                updates itself, so you only need to install once.
              </p>
            </div>
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 text-sm text-accent transition-opacity duration-200 hover:opacity-80"
            >
              All releases
              <ArrowUpRight size={14} />
            </a>
          </div>
        </Reveal>
      </Container>
    </>
  );
};

export default DownloadPage;
