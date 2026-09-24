import Link from "next/link";

import { Card } from "./ui";
import { Icon } from "./Icon";

export function ErrorState({ title, message, backHref = "/", backLabel = "Back to overview" }: { title: string; message: string; backHref?: string; backLabel?: string }) {
  return (
    <Card className="mx-auto max-w-xl p-6">
      <div className="flex items-start gap-3">
        <Icon name="alert" size={20} color="var(--status-critical)" className="mt-0.5 shrink-0" />
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-ink-2 break-words">{message}</p>
          <Link href={backHref} className="link mt-4 inline-block text-sm">
            ← {backLabel}
          </Link>
        </div>
      </div>
    </Card>
  );
}
