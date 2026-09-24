import { Card } from "./ui";

/** Shown when no RAILWAY_TOKEN_* variable is configured. */
export function SetupGuide() {
  const steps = [
    {
      title: "Create a Railway account token",
      body: (
        <>
          Open <span className="font-mono">railway.com/account/tokens</span>, click <em>Create token</em> and pick{" "}
          <strong>No workspace</strong>. That single token can read every workspace you belong to — your Hobby and Pro ones.
        </>
      ),
    },
    {
      title: "Put it in .env.local",
      body: (
        <>
          Copy <span className="font-mono">.env.example</span> to <span className="font-mono">.env.local</span> in this folder and set{" "}
          <span className="font-mono">RAILWAY_TOKEN_MAIN=</span> to the token. More tokens can be added as{" "}
          <span className="font-mono">RAILWAY_TOKEN_&lt;NAME&gt;</span>.
        </>
      ),
    },
    {
      title: "Optional safety settings",
      body: (
        <>
          <span className="font-mono">PROTECTED_PROJECTS</span> lists projects that can never be changed from here;{" "}
          <span className="font-mono">DASHBOARD_READ_ONLY=true</span> turns every action off.
        </>
      ),
    },
    {
      title: "Restart the dashboard",
      body: (
        <>
          Stop and re-run <span className="font-mono">npm run dev</span>, then reload this page. Want to look around first? Run{" "}
          <span className="font-mono">npm run demo</span> for fake data.
        </>
      ),
    },
  ];
  return (
    <Card className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">Connect your Railway account</h1>
      <p className="mt-1 text-sm text-ink-2">No Railway token is configured yet. Four steps:</p>
      <ol className="mt-5 space-y-4">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold">{i + 1}</span>
            <div>
              <div className="font-medium">{step.title}</div>
              <p className="mt-0.5 text-sm text-ink-2">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 border-t border-line pt-4 text-xs text-ink-2">
        The token stays on this machine: it&apos;s read by the Next.js server only and never sent to the browser. The dashboard listens on
        127.0.0.1, so other devices on your network can&apos;t reach it.
      </p>
    </Card>
  );
}
