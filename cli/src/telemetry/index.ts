/**
 * Telemetry Module
 *
 * Opt-in data collection for building AI eval datasets.
 * Collects session metrics, tool calls, and exports to
 * various formats (DeepEval, OpenAI Evals, raw JSONL).
 */

import { TelemetryCollector } from "./collector.ts";
import { TelemetryWriter } from "./writer.ts";
import { TelemetryExporter } from "./exporter.ts";
import type { TelemetryLevel, TelemetryOptions, ExportFormat } from "./types.ts";

// Re-export types
export type {
	Session,
	SessionFull,
	ToolCall,
	ToolCallSummary,
	TelemetryLevel,
	TelemetryConfig,
	TelemetryOptions,
	ExportFormat,
	DeepEvalTestCase,
	DeepEvalExport,
	OpenAIEvalsEntry,
	RawExportEntry,
} from "./types.ts";

// Re-export classes
export { TelemetryCollector } from "./collector.ts";
export { TelemetryWriter } from "./writer.ts";
export { TelemetryExporter } from "./exporter.ts";

// Global state for active telemetry session
let activeCollector: TelemetryCollector | null = null;
let activeWriter: TelemetryWriter | null = null;
let telemetryEnabled = false;

/**
 * Initialize telemetry for a session
 */
export function initTelemetry(
	engine: string,
	mode: string,
	options: TelemetryOptions = {},
): void {
	if (!options.enabled) return;

	telemetryEnabled = true;
	activeWriter = new TelemetryWriter(options.outputDir);
	activeCollector = new TelemetryCollector(engine, mode, {
		level: options.level || "anonymous",
		tags: options.tags,
	});
}

/**
 * Check if telemetry is currently enabled
 */
export function isTelemetryEnabled(): boolean {
	return telemetryEnabled && activeCollector !== null;
}

/**
 * Get the current session ID
 */
export function getSessionId(): string | null {
	return activeCollector?.getSessionId() ?? null;
}

/**
 * Record the start of a task
 */
export function recordTaskStart(): void {
	if (!activeCollector) return;
	activeCollector.recordTaskStart();
}

/**
 * Record task completion
 */
export function recordTaskComplete(
	success: boolean,
	tokensIn: number,
	tokensOut: number,
	prompt?: string,
	response?: string,
): void {
	if (!activeCollector) return;
	activeCollector.recordTaskComplete(success, tokensIn, tokensOut, prompt, response);
}

/**
 * Start tracking a tool call
 */
export function startToolCall(
	toolName: string,
	parameters?: Record<string, unknown>,
): void {
	if (!activeCollector) return;
	activeCollector.startToolCall(toolName, parameters);
}

/**
 * End the current tool call
 */
export function endToolCall(
	success: boolean,
	errorType?: string,
	result?: string,
): void {
	if (!activeCollector) return;
	activeCollector.endToolCall(success, errorType, result);
}

/**
 * Record a complete tool call (start + end)
 */
export function recordToolCall(
	toolName: string,
	durationMs: number,
	success: boolean,
	options?: {
		errorType?: string;
		parameterKeys?: string[];
		parameters?: Record<string, unknown>;
		result?: string;
	},
): void {
	if (!activeCollector) return;
	activeCollector.recordToolCall(toolName, durationMs, success, options);
}

/**
 * Add tags to the current session
 */
export function addSessionTags(tags: string[]): void {
	if (!activeCollector) return;
	activeCollector.addTags(tags);
}

/**
 * Get current metrics for display
 */
export function getCurrentMetrics(): {
	taskCount: number;
	successCount: number;
	failedCount: number;
	toolCallCount: number;
	tokensIn: number;
	tokensOut: number;
} | null {
	if (!activeCollector) return null;
	return activeCollector.getMetrics();
}

/**
 * End the telemetry session and write data
 */
export async function endTelemetry(): Promise<void> {
	if (!activeCollector || !activeWriter) return;

	const { session, toolCalls } = activeCollector.endSession();
	await activeWriter.write(session, toolCalls);

	// Reset state
	activeCollector = null;
	activeWriter = null;
	telemetryEnabled = false;
}

/**
 * Export telemetry data to a specific format
 */
export async function exportTelemetry(
	format: ExportFormat,
	outputDir?: string,
	outputPath?: string,
): Promise<string> {
	const exporter = new TelemetryExporter(outputDir);
	return exporter.export(format, outputPath);
}

/**
 * Export telemetry data to all formats
 */
export async function exportAllTelemetry(
	outputDir?: string,
): Promise<{ deepeval: string; openai: string; raw: string }> {
	const exporter = new TelemetryExporter(outputDir);
	return exporter.exportAll();
}

/**
 * Get telemetry summary statistics
 */
export async function getTelemetrySummary(outputDir?: string): Promise<{
	sessionCount: number;
	toolCallCount: number;
	engines: string[];
	modes: string[];
	toolsUsed: string[];
	totalTokensIn: number;
	totalTokensOut: number;
	successRate: number;
}> {
	const exporter = new TelemetryExporter(outputDir);
	return exporter.getSummary();
}

/**
 * Get writer stats (for CLI status command)
 */
export async function getTelemetryStats(outputDir?: string): Promise<{
	sessionCount: number;
	toolCallCount: number;
	totalTokensIn: number;
	totalTokensOut: number;
	oldestTimestamp?: number;
	newestTimestamp?: number;
}> {
	const writer = new TelemetryWriter(outputDir);
	return writer.getStats();
}

/**
 * Check if telemetry data exists
 */
export async function hasTelemetryData(outputDir?: string): Promise<boolean> {
	const writer = new TelemetryWriter(outputDir);
	return writer.hasData();
}

/**
 * Get available export files
 */
export async function listExports(outputDir?: string): Promise<string[]> {
	const writer = new TelemetryWriter(outputDir);
	return writer.listExports();
}
