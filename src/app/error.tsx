"use client";

import { useEffect } from "react";

import { buttonClass } from "@/components/button";

export default function ErrorPage({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-1 text-sm text-ink-2 break-words">
        {error.message || "An unexpected error occurred."}
        {error.digest ? ` (ref ${error.digest})` : ""}
      </p>
      <p className="mt-2 text-sm text-ink-2">Nothing was changed on Railway. The details are in the terminal running the dashboard.</p>
      <button type="button" className={`${buttonClass("neutral", "md")} mt-4`} onClick={() => (retry ?? reset)?.()}>
        Try again
      </button>
    </div>
  );
}
