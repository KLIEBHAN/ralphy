import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { TelemetryWriter } from "../writer.ts";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Session, ToolCall } from "../types.ts";

const TEST_DIR = ".ralphy-test-telemetry";

describe("TelemetryWriter", () => {
	let writer: TelemetryWriter;

	beforeEach(async () => {
		// Clean up test directory
		if (existsSync(TEST_DIR)) {
			await rm(TEST_DIR, { recursive: true });
		}
		writer = new TelemetryWriter(TEST_DIR);
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
		durationMs: 100 + index * 10,
		success: true,
	});

	test("writes and reads sessions", async () => {
		const session = createTestSession();
		await writer.writeSession(session);

		const sessions = await writer.readSessions();
		expect(sessions.length).toBe(1);
		expect(sessions[0].sessionId).toBe("test-session-1");
		expect(sessions[0].engine).toBe("claude");
	});

	test("writes and reads tool calls", async () => {
		const toolCalls = [createTestToolCall(1), createTestToolCall(2)];
		await writer.writeToolCalls(toolCalls);

		const readCalls = await writer.readToolCalls();
		expect(readCalls.length).toBe(2);
		expect(readCalls[0].callIndex).toBe(1);
		expect(readCalls[1].callIndex).toBe(2);
	});

	test("writes session and tool calls together", async () => {
		const session = createTestSession();
		const toolCalls = [createTestToolCall(1)];

		await writer.write(session, toolCalls);

		const sessions = await writer.readSessions();
		const calls = await writer.readToolCalls();

		expect(sessions.length).toBe(1);
		expect(calls.length).toBe(1);
	});

	test("appends to existing files", async () => {
		const session1 = createTestSession();
		const session2 = { ...createTestSession(), sessionId: "test-session-2" };

		await writer.writeSession(session1);
		await writer.writeSession(session2);

		const sessions = await writer.readSessions();
		expect(sessions.length).toBe(2);
	});

	test("returns empty array when no data exists", async () => {
		const sessions = await writer.readSessions();
		const toolCalls = await writer.readToolCalls();

		expect(sessions).toEqual([]);
		expect(toolCalls).toEqual([]);
	});

	test("hasData returns false when no files exist", async () => {
		const hasData = await writer.hasData();
		expect(hasData).toBe(false);
	});

	test("hasData returns true after writing data", async () => {
		await writer.writeSession(createTestSession());
		const hasData = await writer.hasData();
		expect(hasData).toBe(true);
	});

	test("getStats returns correct statistics", async () => {
		const session1 = createTestSession();
		const session2 = {
			...createTestSession(),
			sessionId: "test-session-2",
			totalTokensIn: 2000,
			totalTokensOut: 1000,
		};

		await writer.writeSession(session1);
		await writer.writeSession(session2);

		const stats = await writer.getStats();
		expect(stats.sessionCount).toBe(2);
		expect(stats.totalTokensIn).toBe(3000);
		expect(stats.totalTokensOut).toBe(1500);
	});

	test("readSessionToolCalls filters by session ID", async () => {
		const call1: ToolCall = { ...createTestToolCall(1), sessionId: "session-a" };
		const call2: ToolCall = { ...createTestToolCall(2), sessionId: "session-b" };
		const call3: ToolCall = { ...createTestToolCall(3), sessionId: "session-a" };

		await writer.writeToolCalls([call1, call2, call3]);

		const sessionACalls = await writer.readSessionToolCalls("session-a");
		expect(sessionACalls.length).toBe(2);
		expect(sessionACalls.every((c) => c.sessionId === "session-a")).toBe(true);
	});
});
