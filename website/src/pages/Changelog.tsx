import React, { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Container } from "../components/Container";
import { PageHeader } from "../components/PageHeader";
import { Reveal } from "../components/Reveal";
import { GITHUB_REPO, RELEASES_URL } from "../lib/site";

interface Release {
  id: number;
  name: string;
  tag_name: string;
  published_at: string;
  html_url: string;
  body: string;
}

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const Changelog: React.FC = () => {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then(setReleases)
      .catch(() => setFailed(true));
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Changelog"
        title="What's new"
        description="Pulled straight from the GitHub releases of the project."
      />

      <Container className="py-16 md:py-20">
        {failed && (
          <p className="text-sm text-text/50">
            Couldn't load releases right now.{" "}
            <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="text-accent">
              View them on GitHub
            </a>
            .
          </p>
        )}

        {!failed && !releases && <p className="text-sm text-text/40">Loading releases…</p>}

        {releases && releases.length === 0 && (
          <p className="text-sm text-text/50">No releases published yet.</p>
        )}

        <div className="space-y-px">
          {releases?.map((release, i) => (
            <Reveal key={release.id} delay={Math.min(i, 4) * 50}>
              <article className="grid gap-4 border-t border-border/40 py-10 md:grid-cols-[180px_1fr]">
                <div>
                  <p className="text-[15px] font-medium tracking-tight text-accent">
                    {release.tag_name}
                  </p>
                  <p className="mt-1 text-xs text-text/35">{formatDate(release.published_at)}</p>
                </div>

                <div>
                  <h2 className="text-[17px] font-medium tracking-tight">
                    {release.name || release.tag_name}
                  </h2>
                  <div className="mt-3 max-w-[70ch] text-sm leading-relaxed text-text/50 [&_a]:text-accent [&_a:hover]:underline [&_code]:rounded [&_code]:border [&_code]:border-border/50 [&_code]:bg-surface/60 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[12px] [&_code]:text-text/80 [&_h1]:mt-6 [&_h1]:text-[15px] [&_h1]:font-medium [&_h1]:text-text [&_h2]:mt-6 [&_h2]:text-[15px] [&_h2]:font-medium [&_h2]:text-text [&_h3]:mt-5 [&_h3]:text-[14px] [&_h3]:font-medium [&_h3]:text-text/90 [&_li]:mt-1.5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-3 [&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border/40 [&_pre]:bg-surface/50 [&_pre]:p-4 [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-medium [&_strong]:text-text/80 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ node: _node, ...props }) => (
                          <a {...props} target="_blank" rel="noreferrer" />
                        ),
                      }}
                    >
                      {release.body?.trim() || "No release notes."}
                    </ReactMarkdown>
                  </div>
                  <a
                    href={release.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex items-center gap-1.5 text-sm text-text/50 transition-colors duration-200 hover:text-text"
                  >
                    Release on GitHub
                    <ArrowUpRight size={14} />
                  </a>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </>
  );
};

export default Changelog;
