"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useRef, useState, useTransition } from "react";

import { chatAction } from "@/app/actions";
import { MAX_MESSAGE, type ChatMessage } from "@/lib/chat/types";
import { Icon, type IconName } from "./Icon";

/** The four shortcuts at the top of the panel. Each opens the screen where that work happens. */
const QUICK_ACTIONS: { label: string; href: string; icon: IconName }[] = [
  { label: "Remove stopped deployments", href: "/services?show=stopped", icon: "trash" },
  { label: "Rename projects", href: "/rename", icon: "pencil" },
  { label: "Off, but still charging", href: "/#still-on-bill", icon: "wallet" },
  { label: "Needs attention", href: "/services?show=attention", icon: "alert" },
];

const STARTERS = ["What's still charging me with nothing running?", "Which projects need attention?", "What costs the most this period?", "Which projects can I rename?"];

const STORE = "rbi:chat";

/**
 * A small assistant at the bottom right of every page: shortcuts to the key screens, and questions
 * about the user's Railway projects answered from the dashboard's own data. It only links; every
 * change still goes through the usual review.
 */
export function ChatAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const router = useRouter();
  const pathname = usePathname();

  // Keep the conversation for this browser tab across reloads.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(STORE) ?? "[]");
      if (Array.isArray(saved)) setMessages(saved.slice(-20));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-20)));
    } catch {}
  }, [messages]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  function go(href: string, close: boolean) {
    if (close) setOpen(false);
    const [path, hash] = href.split("#");
    if (hash && (path || "/") === pathname) {
      // Same page: set the hash so the page's hashchange listener (e.g. the bill list) reacts.
      window.location.hash = hash;
      return;
    }
    router.push(href);
  }

  function ask(text: string) {
    const question = text.trim().slice(0, MAX_MESSAGE);
    if (!question || pending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setDraft("");
    setError(null);
    start(async () => {
      const res = await chatAction(next);
      if (res.ok) setMessages((m) => [...m, { role: "assistant", content: res.data.content }]);
      else setError(res.error);
    });
  }

  return (
    <>
      {open && (
        <section
          id={panelId}
          role="dialog"
          aria-label="Assistant"
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          className="fixed inset-x-3 bottom-20 z-40 flex max-h-[min(640px,calc(100dvh-7rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-2xl sm:inset-x-auto sm:right-5 sm:w-[400px]"
        >
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <div className="text-sm font-semibold">Ask about your projects</div>
              <div className="text-xs text-ink-2">Answers from this dashboard&apos;s data. It never changes anything.</div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Close the assistant">
              <Icon name="x" size={16} />
            </button>
          </header>

          <nav aria-label="Quick actions" className="grid grid-cols-2 gap-2 border-b border-line bg-surface-2/50 p-3">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.href}
                type="button"
                onClick={() => go(a.href, true)}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-left text-xs font-medium hover:border-[var(--ink-3)] hover:shadow-sm"
              >
                <Icon name={a.icon} size={13} className="shrink-0 text-ink-2" />
                <span className="min-w-0">{a.label}</span>
              </button>
            ))}
          </nav>

          <div ref={listRef} className="min-h-[140px] flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-ink-2">Ask about costs, what&apos;s still charging, what&apos;s broken, or what a project does.</p>
                <div className="flex flex-wrap gap-1.5">
                  {STARTERS.map((s) => (
                    <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-2">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="ml-8 rounded-xl rounded-br-sm bg-[var(--series-1)] px-3 py-2 text-white">
                  {m.content}
                </div>
              ) : (
                <div key={i} className="mr-4 rounded-xl rounded-bl-sm bg-surface-2 px-3 py-2">
                  <Answer text={m.content} onLink={(href) => go(href, false)} />
                </div>
              ),
            )}
            {pending && (
              <div className="mr-4 inline-flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-ink-2">
                <Icon name="loader" size={13} className="animate-spin" /> Looking at your projects…
              </div>
            )}
            {error && (
              <p className="flex items-start gap-1.5 text-xs" role="alert">
                <Icon name="alert" size={12} color="var(--status-critical)" className="mt-0.5 shrink-0" /> {error}
              </p>
            )}
          </div>

          <form
            className="flex items-end gap-2 border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <label htmlFor={`${panelId}-q`} className="sr-only">
              Your question
            </label>
            <textarea
              id={`${panelId}-q`}
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={MAX_MESSAGE}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(draft);
                }
              }}
              placeholder="Ask about a project, a cost…"
              className="max-h-32 min-h-[38px] flex-1 resize-none rounded-lg border border-line-strong bg-page px-3 py-2 text-sm outline-none focus:border-(--series-1)"
            />
            <button
              type="submit"
              disabled={pending || !draft.trim()}
              className="flex h-[38px] items-center rounded-lg bg-[var(--series-1)] px-3 text-sm font-medium text-white disabled:opacity-50"
            >
              Ask
            </button>
          </form>
          {messages.length > 0 && (
            <button type="button" onClick={() => setMessages([])} className="pb-2 text-center text-xs text-ink-2 hover:text-ink">
              Clear conversation
            </button>
          )}
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={open ? "Close the assistant" : "Open the assistant"}
        className="fixed bottom-5 right-5 z-40 flex h-12 items-center gap-2 rounded-full bg-[var(--series-1)] px-4 text-sm font-medium text-white shadow-lg hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Icon name={open ? "x" : "info"} size={16} />
        <span className="hidden sm:inline">{open ? "Close" : "Ask"}</span>
      </button>
    </>
  );
}

/**
 * A tiny, safe Markdown subset for answers: paragraphs, "- " lists, **bold**, _italic_ and links to
 * paths inside this app. Anything else stays plain text (no HTML is ever injected).
 */
function Answer({ text, onLink }: { text: string; onLink: (href: string) => void }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-0.5 pl-4">
              {lines.map((l, j) => (
                <li key={j}>
                  <Inline text={l.replace(/^\s*[-*] /, "")} onLink={onLink} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {/^\s*[-*] /.test(l) ? "• " : null}
                <Inline text={l.replace(/^\s*[-*] /, "")} onLink={onLink} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

const TOKEN = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|_([^_]+)_/g;

function Inline({ text, onLink }: { text: string; onLink: (href: string) => void }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[1] !== undefined) {
      const href = m[2];
      // Only links inside this dashboard; anything else is shown as text.
      if (href.startsWith("/") && !href.startsWith("//")) {
        out.push(
          <Link
            key={at}
            href={href}
            className="font-medium text-link underline underline-offset-2"
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey) return;
              e.preventDefault();
              onLink(href);
            }}
          >
            {m[1]}
          </Link>,
        );
      } else out.push(m[1]);
    } else if (m[3] !== undefined) out.push(<strong key={at}>{m[3]}</strong>);
    else if (m[4] !== undefined) out.push(<em key={at}>{m[4]}</em>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
