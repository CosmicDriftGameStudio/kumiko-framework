import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const jqPath = join(import.meta.dir, "../pin-drift.jq");

function pinDrift(
	manifest: Record<string, unknown>,
	expected: Record<string, string>,
): string {
	const result = spawnSync(
		"jq",
		["-r", "--argjson", "expected", JSON.stringify(expected), "-f", jqPath],
		{ input: JSON.stringify(manifest), encoding: "utf-8" },
	);
	if (result.status !== 0) {
		throw new Error(result.stderr || "jq failed");
	}
	return (result.stdout ?? "").trim();
}

describe("pin-drift.jq", () => {
	test("independent version lines: cli@0.2 may pin dev-server@0.67", () => {
		expect(
			pinDrift(
				{ dependencies: { "@cosmicdrift/kumiko-dev-server": "0.67.0" } },
				{
					"@cosmicdrift/kumiko-cli": "0.2.0",
					"@cosmicdrift/kumiko-dev-server": "0.67.0",
				},
			),
		).toBe("");
	});

	test("stale internal pin is reported", () => {
		expect(
			pinDrift(
				{ dependencies: { "@cosmicdrift/kumiko-framework": "0.57.0" } },
				{
					"@cosmicdrift/kumiko-renderer": "0.64.0",
					"@cosmicdrift/kumiko-framework": "0.64.0",
				},
			),
		).toBe("@cosmicdrift/kumiko-framework@0.57.0");
	});

	test("peerDependencies are checked too", () => {
		expect(
			pinDrift(
				{ peerDependencies: { "@cosmicdrift/kumiko-framework": "0.66.0" } },
				{ "@cosmicdrift/kumiko-framework": "0.67.0" },
			),
		).toBe("@cosmicdrift/kumiko-framework@0.66.0");
	});
});
