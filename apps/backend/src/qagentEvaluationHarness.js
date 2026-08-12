import fs from "node:fs/promises";
import { z } from "zod";

export const QAGENT_EVALUATION_HARNESS_VERSION = "qagent-evaluation-harness/v1";

const ModeMetricsSchema = z.object({
  quality: z.number().min(0).max(1),
  accepted: z.boolean(),
  humanCorrectionProxy: z.number().min(0),
  latencyMs: z.number().min(0),
  tokens: z.number().int().min(0),
  costUsd: z.number().min(0),
  modelCalls: z.number().int().min(0),
  toolCalls: z.number().int().min(0),
  regressions: z.number().int().min(0),
  decisionImpact: z.enum(["none", "provisional_branch_evaluation_changed"])
}).strict();

const FixtureSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  modes: z.object({
    no_qagent: ModeMetricsSchema,
    single_agent_reflection: ModeMetricsSchema,
    qagent_assisted: ModeMetricsSchema
  }).strict()
}).strict();

const FixtureFileSchema = z.object({ version: z.string().min(1), fixtures: z.array(FixtureSchema).min(1) }).strict();

export async function loadQAgentDeterministicFixtures(filePath) {
  return FixtureFileSchema.parse(JSON.parse(await fs.readFile(filePath, "utf8")));
}

/**
 * This is a measurement harness, not a claim of production benefit. The fixture
 * oracle supplies each representative outcome; CI verifies that every mode is
 * compared on exactly the same fixture and reports negative/no-effect results.
 */
export function runQAgentEvaluationHarness({ fixtureFile, liveEnabled = false, liveCostCapUsd = 0.25 } = {}) {
  const fixtures = FixtureFileSchema.parse(fixtureFile);
  const modes = ["no_qagent", "single_agent_reflection", "qagent_assisted"];
  const results = fixtures.fixtures.flatMap((fixture) => modes.map((mode) => {
    const metrics = fixture.modes[mode];
    const baseline = fixture.modes.no_qagent;
    const acceptedImprovement = Number(metrics.accepted && !baseline.accepted && metrics.decisionImpact === "provisional_branch_evaluation_changed");
    return {
      fixtureId: fixture.id,
      mode,
      ...metrics,
      acceptedImprovement,
      costPerAcceptedImprovement: acceptedImprovement ? metrics.costUsd / acceptedImprovement : null,
      attribution: "deterministic_fixture_oracle_only; not a production causal claim"
    };
  }));
  const summary = Object.fromEntries(modes.map((mode) => {
    const rows = results.filter((row) => row.mode === mode);
    const acceptedImprovements = rows.reduce((sum, row) => sum + row.acceptedImprovement, 0);
    const costUsd = rows.reduce((sum, row) => sum + row.costUsd, 0);
    return [mode, {
      fixtures: rows.length,
      accepted: rows.filter((row) => row.accepted).length,
      humanCorrectionProxy: rows.reduce((sum, row) => sum + row.humanCorrectionProxy, 0),
      latencyMs: rows.reduce((sum, row) => sum + row.latencyMs, 0),
      tokens: rows.reduce((sum, row) => sum + row.tokens, 0),
      costUsd,
      modelCalls: rows.reduce((sum, row) => sum + row.modelCalls, 0),
      toolCalls: rows.reduce((sum, row) => sum + row.toolCalls, 0),
      regressions: rows.reduce((sum, row) => sum + row.regressions, 0),
      acceptedImprovements,
      costPerAcceptedImprovement: acceptedImprovements ? costUsd / acceptedImprovements : null
    }];
  }));
  return {
    version: QAGENT_EVALUATION_HARNESS_VERSION,
    fixtureVersion: fixtures.version,
    mode: "deterministic_ci",
    results,
    summary,
    liveProvider: liveEnabled
      ? { status: "blocked", reason: "No live-provider adapter is invoked by the deterministic harness.", budgetCapUsd: Math.max(0, Number(liveCostCapUsd) || 0) }
      : { status: "opt_in_disabled", budgetCapUsd: Math.max(0, Number(liveCostCapUsd) || 0) },
    attribution: "Fixture results are regression evidence only; they do not establish production improvement."
  };
}
