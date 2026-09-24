import "server-only";

import { cookies } from "next/headers";

import { isEnvReadOnly, WRITE_MODE_COOKIE } from "./config";

/** True unless Write mode is on (and DASHBOARD_READ_ONLY is not set). */
export async function isReadOnly() {
  if (isEnvReadOnly()) return true;
  const jar = await cookies();
  return jar.get(WRITE_MODE_COOKIE)?.value !== "1";
}
