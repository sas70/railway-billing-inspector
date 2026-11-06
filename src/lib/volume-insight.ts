import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { aiSummariesAvailable, repoCodeContext, savedSummaries, SUMMARY_MODEL } from "./code/ai-summary";
import { getAccount, isMockMode } from "./config";
import { UserFacingError } from "./plans";
import { money, sizeMB } from "./format";
import { loadEnvironment, loadProject } from "./railway/api";
import { guessVolumeKind, volumeCostPerDay } from "./volume-kind";

/**
 * "What's in this volume?" Railway's API can't list a volume's files, so Claude writes its best
 * explanation from what is known: the attached service's image and repo, the mount path, the size,
 * the other services in the project, and the code (summary plus key files). The answer is saved
 * under data/volume-notes and shown again until someone asks for a new one.
 */

const NOTES_DIR = path.join(process.env.AUDIT_LOG_DIR ?? path.join(process.cwd(), "data"), "volume-notes");

export const VolumeNoteSchema = z.object({
  headline: z.string().describe("One short line, e.g. '1 GB of Redis data from a job queue nobody runs any more'"),
  explanation: z
    .string()
    .describe("One plain paragraph for the owner: what this volume most likely holds and why, what it costs, and whether anything still uses it"),
  likelyContents: z.array(z.string()).describe("Up to 6 concrete kinds of data likely on it, e.g. 'BullMQ job records', 'session keys'"),
  confidence: z.enum(["high", "medium", "low"]).describe("How sure, given only the evidence provided"),
  beforeDeleting: z.string().describe("One or two sentences: what would be lost, and how to keep a copy if it matters"),
});
export type VolumeNoteBody = z.infer<typeof VolumeNoteSchema>;

export type VolumeNote = {
  version: 1;
  volumeId: string;
  generatedAt: string;
  model: string;
  /** The size it was written for, so the page can say when it has grown or shrunk since. */
  usedMB: number;
  note: VolumeNoteBody;
  demo?: boolean;
};

const fileFor = (volumeId: string) => path.join(NOTES_DIR, `${volumeId.replace(/[^a-zA-Z0-9-]/g, "")}.json`);

export async function savedVolumeNote(volumeId: string): Promise<VolumeNote | null> {
  if (isMockMode()) return null;
  try {
    const data = JSON.parse(await readFile(fileFor(volumeId), "utf8")) as VolumeNote;
    return data.version === 1 && VolumeNoteSchema.safeParse(data.note).success ? data : null;
  } catch {
    return null;
  }
}

export const volumeNotesAvailable = () => isMockMode() || aiSummariesAvailable();

const SYSTEM = `You help a developer understand a storage volume on Railway that is still billing them, often for a project with nothing running. Railway does not let anyone list the files in a volume, so you must reason from the evidence given: the attached service's Docker image or repository, the mount path, the used size, the other services in the project, and the code. Say what the volume most likely holds and why, in plain words for the owner. Be concrete (name the likely data, e.g. "BullMQ job records" or "user uploads"), say how sure you are, and never present a guess as a fact. Do not tell them to delete it; say what would be lost.`;

let client: Anthropic | null = null;

const ID = /^[a-zA-Z0-9-]{1,64}$/;

/** Write (or rewrite) the explanation for one volume. Reads Railway; never changes anything there. */
export async function explainVolume(input: unknown): Promise<VolumeNote> {
  const raw = (input ?? {}) as Record<string, unknown>;
  for (const k of ["accountKey", "projectId", "environmentId", "volumeId"]) {
    if (typeof raw[k] !== "string" || !ID.test(raw[k] as string)) throw new UserFacingError("Invalid volume.");
  }
  const account = getAccount(raw.accountKey as string);
  if (!account) throw new UserFacingError("Unknown account.");
  if (!volumeNotesAvailable()) throw new UserFacingError("Set ANTHROPIC_API_KEY in .env.local to turn on Claude explanations.");

  const project = await loadProject(account, raw.projectId as string);
  const envView = await loadEnvironment(account, project.id, raw.environmentId as string);
  const vol = envView.volumes.find((v) => v.volume.id === raw.volumeId);
  if (!vol) throw new UserFacingError("That volume isn't in this environment any more. Press Refresh.");
  const attached = envView.instances.find((i) => i.serviceId === vol.serviceId);
  const image = attached?.source?.image ?? null;
  const repo = attached?.source?.repo ?? null;
  const kind = guessVolumeKind({ image, mountPath: vol.mountPath, hasRepo: !!repo });
  const perDay = volumeCostPerDay(vol.currentSizeMB);

  if (isMockMode()) {
    return {
      version: 1,
      volumeId: vol.volume.id,
      generatedAt: new Date().toISOString(),
      model: "demo",
      usedMB: vol.currentSizeMB,
      demo: true,
      note: {
        headline: `${sizeMB(vol.currentSizeMB)} of ${kind.label.toLowerCase()} with nothing running`,
        explanation: `${kind.contents} It costs about ${money(perDay)} a day. (Demo: a real explanation comes from Claude with your API key.)`,
        likelyContents: [kind.label],
        confidence: kind.basis === "image" ? "medium" : "low",
        beforeDeleting: kind.keepCopy,
      },
    };
  }

  const siblings = envView.instances.filter((i) => i.serviceId !== vol.serviceId);
  const repos = [...new Set([repo, ...siblings.map((s) => s.source?.repo ?? null)].filter((r): r is string => !!r))];
  const summaries = await savedSummaries(repos);
  const code = repo ? await repoCodeContext(repo).catch(() => null) : null;

  const facts = [
    `Project: ${project.name}${project.description ? ` (${project.description})` : ""}`,
    `Environment: ${envView.name}`,
    `Volume: ${vol.volume.name}, mounted at ${vol.mountPath}, ${sizeMB(vol.currentSizeMB)} used of ${sizeMB(vol.sizeMB)} allocated, about ${money(perDay)} a day.`,
    attached
      ? `Attached service: ${attached.serviceName}; status ${attached.healthInfo.health}; image ${image ?? "none"}; repo ${repo ?? "none"}.`
      : "Attached service: none.",
    `Other services in this environment: ${siblings.length ? siblings.map((s) => `${s.serviceName} (${s.healthInfo.health}; ${s.source?.image ?? s.source?.repo ?? "no source"})`).join("; ") : "none"}.`,
    `First guess from the image and path: ${kind.label}. ${kind.contents}`,
    ...[...summaries.entries()].map(([k, s]) => `Code summary of ${k}: ${s.summary.summary} Features: ${s.summary.features.join("; ")}. Uses: ${s.summary.services.join(", ")}.`),
  ];
  const context = `${facts.join("\n")}${code ? `\n\nCode of the attached service's repo:\n${code}` : ""}`;

  client ??= new Anthropic();
  const response = await client.beta.messages.parse({
    model: SUMMARY_MODEL,
    max_tokens: 3000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(VolumeNoteSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: context }],
  });
  if (response.stop_reason === "refusal") throw new UserFacingError("Claude declined to explain this volume.");
  if (!response.parsed_output) throw new UserFacingError(`No explanation returned (stop reason: ${response.stop_reason}).`);

  const record: VolumeNote = {
    version: 1,
    volumeId: vol.volume.id,
    generatedAt: new Date().toISOString(),
    model: SUMMARY_MODEL,
    usedMB: vol.currentSizeMB,
    note: response.parsed_output,
  };
  await mkdir(NOTES_DIR, { recursive: true });
  await writeFile(fileFor(vol.volume.id), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
