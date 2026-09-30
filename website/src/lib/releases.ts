export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
  download_count: number;
}

export interface LatestRelease {
  tag_name: string;
  published_at: string;
  html_url: string;
  assets: ReleaseAsset[];
}

export type PlatformId = "windows" | "macos" | "linux";

const MATCHERS: Record<PlatformId, RegExp> = {
  windows: /\.(exe|msi)$/i,
  macos: /(\.dmg|\.app\.tar\.gz)$/i,
  linux: /\.(appimage|deb|rpm)$/i,
};

const IGNORED = /(\.sig$|latest\.json$)/i;

export const PLATFORM_LABELS: Record<PlatformId, { name: string; requirement: string }> = {
  windows: { name: "Windows", requirement: "Windows 10 and 11, 64-bit" },
  macos: { name: "macOS", requirement: "macOS 10.13 or later, Apple silicon and Intel" },
  linux: { name: "Linux", requirement: "AppImage, Debian and RPM based distributions" },
};

/** Groups the assets of a release into the platform buckets shown on the download page. */
export function groupAssets(assets: ReleaseAsset[]): Record<PlatformId, ReleaseAsset[]> {
  const grouped: Record<PlatformId, ReleaseAsset[]> = { windows: [], macos: [], linux: [] };

  for (const asset of assets) {
    if (IGNORED.test(asset.name)) continue;

    for (const platform of Object.keys(MATCHERS) as PlatformId[]) {
      if (MATCHERS[platform].test(asset.name)) {
        grouped[platform].push(asset);
        break;
      }
    }
  }

  return grouped;
}

/** Best guess at the visitor's operating system, used to highlight one card. */
export function detectPlatform(): PlatformId | null {
  if (typeof navigator === "undefined") return null;

  const agent = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (agent.includes("win")) return "windows";
  if (agent.includes("mac")) return "macos";
  if (agent.includes("linux") || agent.includes("x11")) return "linux";
  return null;
}

/** Renders a byte count as a short human readable size. */
export function formatSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

/** Turns an asset file name into a short label such as "Installer (.exe)". */
export function assetLabel(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".exe")) return "Installer (.exe)";
  if (lower.endsWith(".msi")) return "Installer (.msi)";
  if (lower.endsWith(".dmg")) return lower.includes("aarch64") ? "Disk image, Apple silicon" : "Disk image (.dmg)";
  if (lower.endsWith(".app.tar.gz")) return "App bundle (.tar.gz)";
  if (lower.endsWith(".appimage")) return "AppImage";
  if (lower.endsWith(".deb")) return "Debian package (.deb)";
  if (lower.endsWith(".rpm")) return "RPM package (.rpm)";
  return name;
}
