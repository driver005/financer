import { BookOpen, Bug, ExternalLink, FileText, Github, Info, Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { VersionBadge, useLatestRelease, useRepo } from "@/components/version-badge";
import { useI18n } from "@/lib/i18n";
import {
  appBuildDate,
  appCommit,
  appVersion,
  changelogUrl,
  docsHomeUrl,
  issuesNewUrl,
  releaseUrl,
  repoHomeUrl,
} from "@/lib/version";

/** Settings → "Tentang aplikasi": running version, commit, build date and project links. */
export function AboutCard() {
  const { t, lang } = useI18n();
  const repo = useRepo();
  const latest = useLatestRelease();
  const version = appVersion();
  const commit = appCommit();
  const built = appBuildDate();
  const builtLabel = built
    ? new Date(built).toLocaleString(lang === "en" ? "en-US" : "id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : t("Tidak diketahui");

  const links = [
    { href: releaseUrl(repo, version), label: t("Catatan rilis"), icon: Tag },
    { href: changelogUrl(repo), label: "CHANGELOG", icon: FileText },
    { href: repoHomeUrl(repo), label: t("Repositori GitHub"), icon: Github },
    { href: docsHomeUrl(repo), label: t("Dokumentasi"), icon: BookOpen },
    { href: issuesNewUrl(repo), label: t("Laporkan bug"), icon: Bug },
  ];

  return (
    <Card className="mt-4 min-w-0 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Info className="size-4" /> {t("Tentang aplikasi")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("Versi yang sedang berjalan dan tautan proyek.")}
      </p>
      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">{t("Versi")}</dt>
        <dd className="min-w-0">
          <VersionBadge variant="settings" className="text-sm" />
        </dd>
        <dt className="text-muted-foreground">{t("Commit")}</dt>
        <dd className="num min-w-0 break-all">{commit || t("Tidak diketahui")}</dd>
        <dt className="text-muted-foreground">{t("Tanggal build")}</dt>
        <dd className="num min-w-0">{builtLabel}</dd>
      </dl>

      {latest ? (
        latest.newer ? (
          <div className="mt-4 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
            <p className="font-medium">
              {t("Versi baru tersedia")}:{" "}
              <a
                href={latest.url}
                target="_blank"
                rel="noopener noreferrer"
                className="num text-primary underline underline-offset-2"
              >
                v{latest.latest}
              </a>
            </p>
            <p className="mt-1 text-muted-foreground">
              {t(
                "Cara update: buka fork kamu di GitHub → Sync fork → Update branch. Vercel otomatis redeploy dalam beberapa menit.",
              )}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">{t("Kamu memakai versi terbaru.")}</p>
        )
      ) : null}

      <ul className="mt-4 flex flex-wrap gap-2">
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <l.icon className="size-4" aria-hidden="true" /> {l.label}
              <ExternalLink className="size-3 text-muted-foreground" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
