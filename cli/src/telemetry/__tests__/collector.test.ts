import { describe, test, expect, beforeEach } from "bun:test";
import { TelemetryCollector } from "../collector.ts";

describe("TelemetryCollector", () => {
	let collector: TelemetryCollector;

	beforeEach(() => {
		collector = new TelemetryCollector("claude", "sequential");
	});

	test("generates unique session ID", () => {
		const id = collector.getSessionId();
		expect(id).toBeTruthy();
		expect(id.length).toBeGreaterThan(0);

		// Should be UUID format
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
	});

	test("tracks task counts", () => {
		collector.recordTaskStart();
		collector.recordTaskComplete(true, 100, 50);

		collector.recordTaskStart();
		collector.recordTaskComplete(false, 200, 100);

		const metrics = collector.getMetrics();
		expect(metrics.taskCount).toBe(2);
		expect(metrics.successCount).toBe(1);
		expect(metrics.failedCount).toBe(1);
	});

	test("tracks token counts", () => {
		collector.recordTaskComplete(true, 1000, 500);
		collector.recordTaskComplete(true, 2000, 1000);

		const metrics = collector.getMetrics();
		expect(metrics.tokensIn).toBe(3000);
		expect(metrics.tokensOut).toBe(1500);
	});

	test("records tool calls with start/end pattern", () => {
		collector.startToolCall("Read", { file_path: "/test.txt" });
		collector.endToolCall(true);

		collector.startToolCall("Edit");
		collector.endToolCall(false, "permission");

		const metrics = collector.getMetrics();
		expect(metrics.toolCallCount).toBe(2);
	});

	test("records tool calls with single method", () => {
		collector.recordToolCall("Read", 100, true);
		collector.recordToolCall("Edit", 200, false, { errorType: "permission" });

		const metrics = collector.getMetrics();
		expect(metrics.toolCallCount).toBe(2);
	});

	test("adds tags to session", () => {
		collector.addTags(["test", "experiment"]);
		collector.addTags(["feature-x"]);

		const { session } = collector.endSession();
		expect(session.tags).toEqual(["test", "experiment", "feature-x"]);
	});

	test("endSession returns complete session record", () => {
		collector.recordTaskStart();
		collector.recordTaskComplete(true, 500, 250);
		collector.recordToolCall("Read", 50, true);
		collector.recordToolCall("Edit", 150, true);

		const { session, toolCalls } = collector.endSession();

		expect(session.sessionId).toBeTruthy();
		expect(session.engine).toBe("claude");
		expect(session.mode).toBe("sequential");
		expect(session.taskCount).toBe(1);
		expect(session.successCount).toBe(1);
		expect(session.totalTokensIn).toBe(500);
		expect(session.totalTokensOut).toBe(250);
		expect(session.toolCalls.length).toBe(2);
		expect(toolCalls.length).toBe(2);
	});

	test("tool call summaries are computed correctly", () => {
		collector.recordToolCall("Read", 100, true);
		collector.recordToolCall("Read", 150, true);
		collector.recordToolCall("Edit", 200, true);
		collector.recordToolCall("Read", 50, false, { errorType: "permission" });

		const { session } = collector.endSession();

		const readSummary = session.toolCalls.find((tc) => tc.toolName === "Read");
		expect(readSummary).toBeTruthy();
		expect(readSummary?.callCount).toBe(3);
		expect(readSummary?.successCount).toBe(2);
		expect(readSummary?.failedCount).toBe(1);
		expect(readSummary?.avgDurationMs).toBe(100); // (100+150+50)/3

		const editSummary = session.toolCalls.find((tc) => tc.toolName === "Edit");
		expect(editSummary).toBeTruthy();
		expect(editSummary?.callCount).toBe(1);
	});

	test("full mode includes prompts and responses", () => {
		const fullCollector = new TelemetryCollector("claude", "sequential", {
			level: "full",
		});

		fullCollector.recordTaskComplete(true, 100, 50, "Fix the bug", "Done!");

		const { session } = fullCollector.endSession();

		// Full mode should include prompt/response
		expect("prompt" in session).toBe(true);
		expect("response" in session).toBe(true);
	});

	test("anonymous mode excludes prompts and responses", () => {
		collector.recordTaskComplete(true, 100, 50, "Fix the bug", "Done!");

		const { session } = collector.endSession();

		// Anonymous mode should not include prompt/response
		expect("prompt" in session).toBe(false);
		expect("response" in session).toBe(false);
	});
});
