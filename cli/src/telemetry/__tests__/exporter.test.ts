import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { TelemetryExporter } from "../exporter.ts";
import { TelemetryWriter } from "../writer.ts";
import { rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Session, ToolCall } from "../types.ts";

const TEST_DIR = ".ralphy-test-exporter";

describe("TelemetryExporter", () => {
	let exporter: TelemetryExporter;
	let writer: TelemetryWriter;

	beforeEach(async () => {
		// Clean up test directory
		if (existsSync(TEST_DIR)) {
			await rm(TEST_DIR, { recursive: true });
		}
		writer = new TelemetryWriter(TEST_DIR);
		exporter = new TelemetryExporter(TEST_DIR);
	});

	afterEach(async () => {
		// Clean up after tests
		if (existsSync(TEST_DIR)) {
			await rm(TEST_DIR, { recursive: true });
		}
	});

	const createTestSession = (): Session => ({
		sessionId: "test-session-1",
		timestamp: Date.now(),
		engine: "claude",
		mode: "sequential",
		cliVersion: "1.0.0",
		platform: "darwin",
		totalTokensIn: 1000,
		totalTokensOut: 500,
		totalDurationMs: 5000,
		taskCount: 2,
		successCount: 2,
		failedCount: 0,
		toolCalls: [
			{
				toolName: "Read",
				callCount: 3,
				successCount: 3,
				failedCount: 0,
				avgDurationMs: 100,
			},
		],
	});

	const createTestToolCall = (index: number): ToolCall => ({
		sessionId: "test-session-1",
		callIndex: index,
		timestamp: Date.now(),
		toolName: "Read",
		durationMs: 100,
		success: true,
	});

	test("exports to DeepEval format", async () => {
		await writer.writeSession(createTestSession());
		await writer.writeToolCalls([createTestToolCall(1)]);

		const filePath = await exporter.exportDeepEval();
		expect(existsSync(filePath)).toBe(true);

		const content = await readFile(filePath, "utf-8");
		const data = JSON.parse(content);

		expect(data.test_cases).toBeDefined();
		expect(data.test_cases.length).toBe(1);
		expect(data.test_cases[0].metadata.engine).toBe("claude");
	});

	test("exports to OpenAI Evals format", async () => {
		await writer.writeSession(createTestSession());
		await writer.writeToolCalls([createTestToolCall(1)]);

		const filePath = await exporter.exportOpenAI();
		expect(existsSync(filePath)).toBe(true);

		const content = await readFile(filePath, "utf-8");
		const lines = content.trim().split("\n");
		expect(lines.length).toBe(1);

		const entry = JSON.parse(lines[0]);
		expect(entry.metadata.engine).toBe("claude");
		expect(entry.metadata.tools_used).toContain("Read");
	});

	test("exports to raw JSONL format", async () => {
		await writer.writeSession(createTestSession());
		await writer.writeToolCalls([createTestToolCall(1), createTestToolCall(2)]);

		const filePath = await exporter.exportRaw();
		expect(existsSync(filePath)).toBe(true);

		const content = await readFile(filePath, "utf-8");
		const lines = content.trim().split("\n");

		// Should have 1 session + 2 tool calls
		expect(lines.length).toBe(3);

		const entries = lines.map((line) => JSON.parse(line));
		const sessionEntry = entries.find((e) => e.type === "session");
		const toolCallEntries = entries.filter((e) => e.type === "tool_call");

		expect(sessionEntry).toBeDefined();
		expect(toolCallEntries.length).toBe(2);
	});

	test("exportAll creates all format files", async () => {
		await writer.writeSession(createTestSession());

		const paths = await exporter.exportAll();

		expect(existsSync(paths.deepeval)).toBe(true);
		expect(existsSync(paths.openai)).toBe(true);
		expect(existsSync(paths.raw)).toBe(true);
	});

	test("getSummary returns correct statistics", async () => {
		const session1 = createTestSession();
		const session2 = {
			...createTestSession(),
			sessionId: "test-session-2",
			engine: "opencode",
			mode: "parallel",
		};

		await writer.writeSession(session1);
		await writer.writeSession(session2);
		await writer.writeToolCalls([createTestToolCall(1), createTestToolCall(2)]);

		const summary = await exporter.getSummary();

		expect(summary.sessionCount).toBe(2);
		expect(summary.toolCallCount).toBe(2);
		expect(summary.engines).toContain("claude");
		expect(summary.engines).toContain("opencode");
		expect(summary.modes).toContain("sequential");
		expect(summary.modes).toContain("parallel");
	});

	test("export method routes to correct format", async () => {
		await writer.writeSession(createTestSession());

		const deepevalPath = await exporter.export("deepeval");
		expect(deepevalPath).toContain("deepeval");

		const openaiPath = await exporter.export("openai");
		expect(openaiPath).toContain("openai");

		const rawPath = await exporter.export("raw");
		expect(rawPath).toContain("raw");
	});

	test("throws on unknown export format", async () => {
		await writer.writeSession(createTestSession());

		// @ts-expect-error Testing invalid format
		await expect(exporter.export("invalid")).rejects.toThrow(
			"Unknown export format",
		);
	});
});
