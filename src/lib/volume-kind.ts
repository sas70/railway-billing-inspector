/**
 * What a volume most likely holds, judged from what is attached to it: the service's Docker image
 * and the mount path. Railway's API can't list the files inside a volume, so this is an educated
 * guess and every caller labels it as one. Pure: no I/O, safe in the browser and in tests.
 */
export type VolumeKind = {
  /** e.g. "Redis data" */
  label: string;
  /** One or two sentences on what such a volume usually contains. */
  contents: string;
  /** How someone could keep a copy before deleting it. */
  keepCopy: string;
  /** How sure the guess is: the image names a known database, or only the path hints at it. */
  basis: "image" | "path" | "unknown";
};

type Rule = { test: RegExp; kind: Omit<VolumeKind, "basis"> };

const IMAGE_RULES: Rule[] = [
  {
    test: /(^|\/)(redis|valkey|keydb)(:|@|$)|redis-stack/i,
    kind: {
      label: "Redis data",
      contents:
        "Redis keeps its whole dataset in memory and writes it to the volume so it survives restarts: a snapshot file (dump.rdb) and, if append-only mode is on, an appendonly log. Typical contents are cache entries, sessions, rate-limit counters and job queues (for example BullMQ or Celery).",
      keepCopy: "Start the service and save a snapshot with redis-cli --rdb dump.rdb, or copy dump.rdb out of /data.",
    },
  },
  {
    test: /(^|\/)(postgres|postgis|timescale|pgvector|supabase\/postgres)|ghcr\.io\/railwayapp-templates\/postgres/i,
    kind: {
      label: "PostgreSQL database",
      contents:
        "The PostgreSQL data directory: every database, table, index and the write-ahead log. This is the app's real data (users, records, uploads metadata), not a cache.",
      keepCopy: "Start the service and run pg_dump against it, then keep the .sql or .dump file.",
    },
  },
  {
    test: /(^|\/)(mysql|mariadb|percona)(:|@|$)/i,
    kind: {
      label: "MySQL database",
      contents: "The MySQL/MariaDB data directory: the databases, tables and binary logs the app stored.",
      keepCopy: "Start the service and run mysqldump, then keep the .sql file.",
    },
  },
  {
    test: /(^|\/)mongo(db)?(:|@|$)/i,
    kind: {
      label: "MongoDB database",
      contents: "The MongoDB data files: every collection and document the app stored, plus indexes and the journal.",
      keepCopy: "Start the service and run mongodump, then keep the dump folder.",
    },
  },
  {
    test: /(^|\/)(minio|seaweedfs)(:|@|\/|$)/i,
    kind: {
      label: "Object storage",
      contents: "Uploaded objects (files, images, backups) stored in buckets, plus the storage server's metadata.",
      keepCopy: "Start the service and copy the buckets out with mc mirror (or any S3 client).",
    },
  },
  {
    test: /(^|\/)(n8n|ghost|wordpress|strapi|directus|metabase|grafana|uptime-kuma|plausible)(:|@|\/|$)/i,
    kind: {
      label: "App data",
      contents: "This app's own storage: its settings, content, uploads and, for many of these apps, a built-in SQLite database.",
      keepCopy: "Use the app's own export, or start the service and copy the mounted folder out.",
    },
  },
  {
    test: /jupyter|notebook/i,
    kind: {
      label: "Notebook files",
      contents: "Notebooks, datasets and anything else saved in the notebook server's working folder.",
      keepCopy: "Start the service and download the files from the notebook UI.",
    },
  },
];

const PATH_RULES: Rule[] = [
  { test: /^\/data\/?$|redis/i, kind: IMAGE_RULES[0].kind },
  { test: /postgres|pgdata/i, kind: IMAGE_RULES[1].kind },
  { test: /mysql/i, kind: IMAGE_RULES[2].kind },
  { test: /mongo|\/data\/db/i, kind: IMAGE_RULES[3].kind },
];

export function guessVolumeKind(input: { image: string | null; mountPath: string; hasRepo: boolean }): VolumeKind {
  const image = input.image?.trim() ?? "";
  if (image) {
    const hit = IMAGE_RULES.find((r) => r.test.test(image));
    if (hit) return { ...hit.kind, basis: "image" };
  }
  if (!input.hasRepo) {
    const hit = PATH_RULES.find((r) => r.test.test(input.mountPath));
    if (hit) return { ...hit.kind, basis: "path" };
  }
  return {
    label: input.hasRepo ? "Files the app wrote" : "Unknown data",
    contents: input.hasRepo
      ? `Whatever the app's code saves under ${input.mountPath}: commonly uploads, generated files, a SQLite database or a cache. The code summary and a Claude explanation can narrow it down.`
      : `Railway doesn't say what is stored under ${input.mountPath}, and there is no image or repo to judge from.`,
    keepCopy: "Start the service and copy the mounted folder out (for example with railway ssh and tar), or use the app's own export.",
    basis: "unknown",
  };
}

/** Railway's list price for volume storage, per GB per month. */
export const VOLUME_PRICE_PER_GB_MONTH = 0.15;

/** What the used space costs per day at list price (Railway bills used GB, minutely). */
export function volumeCostPerDay(usedMB: number): number {
  return (usedMB / 1000) * (VOLUME_PRICE_PER_GB_MONTH / 30);
}
