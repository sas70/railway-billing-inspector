import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-lg border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-1 text-sm text-ink-2">
        That account, project or service isn&apos;t configured here. Account names come from your <span className="font-mono">RAILWAY_TOKEN_*</span>{" "}
        variables.
      </p>
      <Link href="/" className="link mt-4 inline-block text-sm">
        ← Back to overview
      </Link>
    </div>
  );
}
