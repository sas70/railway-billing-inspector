import "server-only";

import path from "node:path";

import { INDEX_DIR } from "./store";

/**
 * Topic embeddings, computed on this machine with a small open model (BAAI bge-small-en-v1.5,
 * about 35 MB, downloaded once into data/search-index/models). Nothing is sent to an API.
 *
 * It needs the optional `@huggingface/transformers` package. If that isn't installed, or the
 * model can't be downloaded, topic search is simply off and keyword search still works.
 */

export const EMBED_MODEL = "Xenova/bge-small-en-v1.5";
/** bge models expect this prefix on queries (not on the documents being searched). */
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

type Extractor = (texts: string[], opts: { pooling: "cls" | "mean"; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;

const store = globalThis as typeof globalThis & { __rbiEmbedder?: Promise<Extractor>; __rbiEmbedError?: { message: string; at: number } | null };
/** After a failed load, wait this long before trying again, so searches don't keep paying for it. */
const RETRY_MS = 10 * 60_000;

function turnedOff(): string | null {
  if (process.env.VERCEL === "1") return "Topic search is off on the hosted demo.";
  if (process.env.SEARCH_EMBEDDINGS?.trim().toLowerCase() === "off") return "Topic search is turned off (SEARCH_EMBEDDINGS=off).";
  return null;
}

/** Why topic search is unavailable right now, or null when it's on (or not tried yet). */
export function embeddingsDisabledReason(): string | null {
  return turnedOff() ?? store.__rbiEmbedError?.message ?? null;
}

async function load(): Promise<Extractor> {
  // A variable specifier keeps bundlers from pulling the (large, optional) package into the build.
  const pkg = "@huggingface/transformers";
  const { env, pipeline } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pkg)) as typeof import("@huggingface/transformers");
  env.cacheDir = path.join(INDEX_DIR, "models");
  env.allowRemoteModels = true;
  const extractor = await pipeline("feature-extraction", EMBED_MODEL, { dtype: "q8" });
  return extractor as unknown as Extractor;
}

function extractor(): Promise<Extractor> {
  store.__rbiEmbedder ??= load().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    store.__rbiEmbedError = {
      at: Date.now(),
      message: /Cannot find (module|package)/i.test(message)
        ? "Topic search needs the optional package @huggingface/transformers. Run npm install, then update the index."
        : `Topic search is off: the embedding model couldn't load (${message.slice(0, 160)}).`,
    };
    store.__rbiEmbedder = undefined;
    throw error;
  });
  return store.__rbiEmbedder;
}

/** L2-normalized embeddings, one per text. Throws if embeddings aren't available. */
export async function embed(texts: string[], kind: "document" | "query"): Promise<Float32Array[]> {
  const off = turnedOff();
  if (off) throw new Error(off);
  const failed = store.__rbiEmbedError;
  if (failed && Date.now() - failed.at < RETRY_MS) throw new Error(failed.message);
  const run = await extractor();
  store.__rbiEmbedError = null;
  const input = kind === "query" ? texts.map((t) => QUERY_PREFIX + t) : texts;
  const out: Float32Array[] = [];
  for (let i = 0; i < input.length; i += 16) {
    const batch = input.slice(i, i + 16);
    const result = await run(batch, { pooling: "cls", normalize: true });
    const dim = result.dims[result.dims.length - 1];
    for (let j = 0; j < batch.length; j++) out.push(Float32Array.from(result.data.subarray(j * dim, (j + 1) * dim)));
  }
  return out;
}

export function toBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function fromBlob(blob: Buffer): Float32Array {
  const copy = new Uint8Array(blob.byteLength);
  copy.set(blob);
  return new Float32Array(copy.buffer);
}
