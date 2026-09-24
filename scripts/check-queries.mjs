#!/usr/bin/env node
/**
 * Validates every GraphQL document the dashboard sends against Railway's LIVE schema.
 *
 *   npm run check:queries                 # introspects https://backboard.railway.com/graphql/v2
 *   npm run check:queries -- --schema f.json   # validate against a saved introspection result
 *
 * Introspection works without a token, so this is safe to run any time. Nothing is
 * executed: documents are only parsed and validated locally.
 */
import { readFileSync } from "node:fs";
import {
  buildClientSchema,
  getIntrospectionQuery,
  NoDeprecatedCustomRule,
  parse,
  specifiedRules,
  validate,
} from "graphql";

const ENDPOINT = "https://backboard.railway.com/graphql/v2";

const source = readFileSync(new URL("../src/lib/railway/documents.ts", import.meta.url), "utf8");
const documents = [...source.matchAll(/\/\* GraphQL \*\/ `([\s\S]*?)`/g)].map((match) => match[1]);

if (documents.length === 0) {
  console.error("No GraphQL documents found in src/lib/railway/documents.ts");
  process.exit(1);
}

async function loadSchema() {
  const flagIndex = process.argv.indexOf("--schema");
  if (flagIndex !== -1) {
    const file = process.argv[flagIndex + 1];
    return buildClientSchema(JSON.parse(readFileSync(file, "utf8")).data);
  }
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: getIntrospectionQuery({ inputValueDeprecation: true }) }),
  });
  if (!response.ok) throw new Error(`Introspection failed: HTTP ${response.status}`);
  const json = await response.json();
  if (!json.data) throw new Error(`Introspection failed: ${JSON.stringify(json.errors ?? json)}`);
  return buildClientSchema(json.data);
}

const schema = await loadSchema();
let failures = 0;
let warnings = 0;

for (const text of documents) {
  let ast;
  try {
    ast = parse(text);
  } catch (error) {
    failures++;
    console.error(`✗ (parse error) ${error.message}`);
    continue;
  }
  const name = ast.definitions[0]?.name?.value ?? "(anonymous)";
  const errors = validate(schema, ast, specifiedRules);
  const deprecations = validate(schema, ast, [NoDeprecatedCustomRule]);
  if (errors.length) {
    failures++;
    console.error(`✗ ${name}`);
    for (const error of errors) console.error(`    ${error.message}`);
  } else {
    console.log(`✓ ${name}`);
  }
  for (const warning of deprecations) {
    warnings++;
    console.warn(`    ⚠ deprecated: ${warning.message}`);
  }
}

console.log(`\n${documents.length} documents · ${failures} invalid · ${warnings} deprecation warnings`);
process.exit(failures ? 1 : 0);
