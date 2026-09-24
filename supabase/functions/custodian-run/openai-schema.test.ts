import {
  CustodianFindingSchema,
  citableEvidenceIdsFromSnapshot,
  classifySynthesisRejection,
  MAX_ENUMERATED_EVIDENCE_IDS,
  synthesisEvidenceIdsWithinSnapshot,
  synthesisTextFormat,
  validSynthesis,
} from "./openai-schema.ts";

function assertEquals(actual: unknown, expected: unknown, label = ""): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const OUTSIDE = "99999999-9999-4999-8999-999999999999";

type Node = Record<string, unknown>;

function finding(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "unresolved",
    title: "Historical unresolved result",
    conclusion: "The single admitted record does not settle the question.",
    analysis_mode: "synthesis",
    confidence: 30,
    supporting_evidence_ids: [],
    contrary_evidence_ids: [],
    uncertainties: ["Only one record was admitted."],
    assumptions: [],
    scope_limits: [],
    evidence_gaps: ["No citable evidence was linked to the Case."],
    what_would_change_mind: "",
    revisit_condition: "",
    ...overrides,
  };
}

function synthesis(...findings: unknown[]) {
  return {
    summary: "Summary.",
    findings,
    requiresApproval: false,
    approvalKind: "canonical_write",
  };
}

function variantsFor(ids: string[]): Node[] {
  const schema = synthesisTextFormat(ids).schema as Node;
  const items = ((schema.properties as Node).findings as Node).items as Node;
  return items.anyOf as Node[];
}

function outcomeOf(variant: Node): string {
  return (((variant.properties as Node).outcome as Node).enum as string[])[0];
}

function evidenceNode(variant: Node, key: string): Node {
  return (variant.properties as Node)[key] as Node;
}

Deno.test("zero citable evidence: the provider schema cannot produce a Finding", () => {
  const variants = variantsFor([]);
  assertEquals(variants.map(outcomeOf), ["unresolved", "no_finding", "refusal"]);
  for (const variant of variants) {
    for (const key of ["supporting_evidence_ids", "contrary_evidence_ids"]) {
      const node = evidenceNode(variant, key);
      // With nothing admitted, no evidence id is legitimate in any outcome.
      assertEquals(node.maxItems, 0, `${outcomeOf(variant)}.${key}`);
    }
  }
});

Deno.test("admitted evidence: ids are enumerated and a Finding needs one", () => {
  const variants = variantsFor([A, B]);
  assertEquals(variants.map(outcomeOf), ["finding", "unresolved", "no_finding", "refusal"]);
  const finding = variants[0];
  const supporting = evidenceNode(finding, "supporting_evidence_ids");
  assertEquals(supporting.minItems, 1);
  assertEquals((supporting.items as Node).enum, [A, B]);
  assertEquals((evidenceNode(finding, "contrary_evidence_ids").items as Node).enum, [A, B]);
  assertEquals(evidenceNode(variants[2], "supporting_evidence_ids").maxItems, 0);
  assertEquals(evidenceNode(variants[3], "contrary_evidence_ids").maxItems, 0);
  assertEquals(evidenceNode(variants[1], "uncertainties").minItems, 1);
});

Deno.test("many admitted ids fall back to UUID strings to respect enum limits", () => {
  const ids = Array.from(
    { length: MAX_ENUMERATED_EVIDENCE_IDS + 1 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  const items = evidenceNode(variantsFor(ids)[0], "supporting_evidence_ids").items as Node;
  assertEquals("enum" in items, false);
  assertEquals(items.format, "uuid");
});

Deno.test("generated provider schema stays inside the supported subset", () => {
  const allowed = new Set([
    "$schema",
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "enum",
    "description",
    "format",
    "pattern",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
    "anyOf",
  ]);
  for (const ids of [[], [A], [A, B]]) {
    const format = synthesisTextFormat(ids);
    assertEquals(format.strict, true);
    const visit = (node: Node, depth: number) => {
      if (depth > 10) throw new Error("too deep");
      for (const key of Object.keys(node)) {
        if (!allowed.has(key)) throw new Error(`unsupported keyword ${key}`);
      }
      if (node.type === "object" && node.additionalProperties !== false) {
        throw new Error("object must forbid additional properties");
      }
      for (const child of Object.values((node.properties as Node) ?? {})) {
        visit(child as Node, depth + 1);
      }
      if (node.items) visit(node.items as Node, depth + 1);
      for (const child of (node.anyOf as Node[]) ?? []) visit(child, depth);
    };
    visit(format.schema as Node, 0);
  }
});

Deno.test("snapshot ids are read defensively", () => {
  assertEquals(citableEvidenceIdsFromSnapshot({ citable_evidence_ids: [A, A, "nope", 3, B] }), [
    A,
    B,
  ]);
  assertEquals(citableEvidenceIdsFromSnapshot({}), []);
});

Deno.test("the historical successful production shape is accepted with zero citable ids", () => {
  const value = synthesis(finding());
  assertEquals(validSynthesis(value), true);
  assertEquals(classifySynthesisRejection(value, { citable_evidence_ids: [] }), null);
});

Deno.test("a valid Finding citing an admitted id is accepted", () => {
  const value = synthesis(finding({ outcome: "finding", supporting_evidence_ids: [A] }));
  assertEquals(classifySynthesisRejection(value, { citable_evidence_ids: [A] }), null);
});

Deno.test("rejections classify to bounded local reasons", () => {
  const snapshot = { citable_evidence_ids: [A, B] };
  const cases: Array<[unknown, string]> = [
    [synthesis(finding({ outcome: "finding" })), "finding_missing_support"],
    [
      synthesis(finding({ uncertainties: [], evidence_gaps: [] })),
      "unresolved_missing_uncertainty",
    ],
    [
      synthesis(finding({ outcome: "finding", supporting_evidence_ids: [A, A] })),
      "evidence_ids_duplicate",
    ],
    [
      synthesis(
        finding({ outcome: "finding", supporting_evidence_ids: [A], contrary_evidence_ids: [A] }),
      ),
      "evidence_ids_overlap",
    ],
    [
      synthesis(finding({ outcome: "finding", supporting_evidence_ids: [OUTSIDE] })),
      "evidence_id_outside_snapshot",
    ],
    [synthesis(finding({ title: "   " })), "text_bounds_violation"],
    [{ summary: "x" }, "invalid_synthesis_schema"],
    [null, "malformed_response_shape"],
    [[], "malformed_response_shape"],
  ];
  for (const [value, reason] of cases) {
    assertEquals(classifySynthesisRejection(value, snapshot), reason, reason);
  }
});

Deno.test("classification never carries provider values", () => {
  const secret = "SECRET-PROVIDER-TEXT-ZZZ";
  const reasons = [
    classifySynthesisRejection(
      synthesis(finding({ outcome: "finding", title: secret, supporting_evidence_ids: [OUTSIDE] })),
      { citable_evidence_ids: [A] },
    ),
    classifySynthesisRejection({ summary: secret }, {}),
  ];
  for (const reason of reasons) {
    if (!reason || reason.includes(secret) || reason.includes(OUTSIDE)) throw new Error("leak");
    if (!/^[a-z_]+$/.test(reason)) throw new Error("reason must be a bounded token");
  }
});

Deno.test("local defense in depth is unchanged", () => {
  assertEquals(synthesisEvidenceIdsWithinSnapshot(synthesis(finding()), {}), true);
  assertEquals(
    CustodianFindingSchema.safeParse(finding({ outcome: "finding", supporting_evidence_ids: [] }))
      .success,
    false,
  );
});
