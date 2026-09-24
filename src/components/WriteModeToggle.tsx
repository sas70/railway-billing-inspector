"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { getWriteModeAction, setWriteModeAction } from "@/app/actions";
import { buttonClass } from "./button";
import { Badge } from "./ui";

export function WriteModeToggle({ envLocked }: { envLocked: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [writeMode, setWriteMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (envLocked) return;
    void getWriteModeAction().then((res) => {
      if (res.ok) setWriteMode(res.data.writeMode);
    });
  }, [envLocked]);

  if (envLocked) {
    return (
      <Badge tone="warning" title="DASHBOARD_READ_ONLY is on in .env: every change is refused">
        Read-only
      </Badge>
    );
  }

  function setMode(enabled: boolean) {
    if (enabled && !window.confirm("Enable Write mode? Turn on / Turn off and other actions will be allowed after you review and approve each one.")) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await setWriteModeAction(enabled);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setWriteMode(res.data.writeMode);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {writeMode ? (
        <>
          <Badge tone="danger" title="Write mode is on: approved actions will change Railway">
            Write mode
          </Badge>
          <button
            type="button"
            className={buttonClass("ghost", "sm")}
            disabled={pending}
            onClick={() => setMode(false)}
            title="Go back to read-only"
          >
            {pending ? "…" : "Read-only"}
          </button>
        </>
      ) : (
        <>
          <Badge tone="warning" title="Write mode is off: every change is refused">
            Read-only
          </Badge>
          <button
            type="button"
            className={buttonClass("neutral", "sm")}
            disabled={pending}
            onClick={() => setMode(true)}
            title="Allow Turn on / Turn off after you review each action"
          >
            {pending ? "…" : "Write mode"}
          </button>
        </>
      )}
      {error && (
        <span className="max-w-48 text-xs text-critical" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
