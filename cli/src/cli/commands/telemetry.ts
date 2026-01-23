/**
 * Telemetry CLI Commands
 *
 * Commands for exporting and viewing telemetry data.
 */

import {
	exportTelemetry,
	exportAllTelemetry,
	getTelemetryStats,
	getTelemetrySummary,
	hasTelemetryData,
	listExports,
} from "../../telemetry/index.ts";
import type { ExportFormat } from "../../telemetry/index.ts";
import { logError, logInfo, logSuccess } from "../../ui/logger.ts";

const DEFAULT_TELEMETRY_DIR = ".ralphy/telemetry";

/**
 * Export telemetry data to specified format(s)
 */
export async function exportTelemetryCommand(options: {
	format?: string;
	outputDir?: string;
	outputPath?: string;
	all?: boolean;
}): Promise<void> {
	const outputDir = options.outputDir || DEFAULT_TELEMETRY_DIR;

	// Check if data exists
	const hasData = await hasTelemetryData(outputDir);
	if (!hasData) {
		logError("No telemetry data found.");
		logInfo(`Enable telemetry with --telemetry flag when running tasks.`);
		logInfo(`Data is stored in: ${outputDir}`);
		return;
	}

	// Export all formats
	if (options.all) {
		logInfo("Exporting to all formats...");
		const paths = await exportAllTelemetry(outputDir);
		logSuccess("Export complete:");
		console.log(`  DeepEval: ${paths.deepeval}`);
		console.log(`  OpenAI:   ${paths.openai}`);
		console.log(`  Raw:      ${paths.raw}`);
		return;
	}

	// Export single format
	const format = (options.format || "raw") as ExportFormat;
	if (!["deepeval", "openai", "raw"].includes(format)) {
		logError(`Unknown format: ${format}`);
		logInfo("Available formats: deepeval, openai, raw");
		return;
	}

	logInfo(`Exporting to ${format} format...`);
	const filePath = await exportTelemetry(format, outputDir, options.outputPath);
	logSuccess(`Exported to: ${filePath}`);
}

/**
 * Show telemetry statistics
 */
export async function showTelemetryStats(options: {
	outputDir?: string;
}): Promise<void> {
	const outputDir = options.outputDir || DEFAULT_TELEMETRY_DIR;

	// Check if data exists
	const hasData = await hasTelemetryData(outputDir);
	if (!hasData) {
		logInfo("No telemetry data collected yet.");
		logInfo(`Enable telemetry with --telemetry flag when running tasks.`);
		return;
	}

	// Get basic stats
	const stats = await getTelemetryStats(outputDir);
	const summary = await getTelemetrySummary(outputDir);

	console.log("\nTelemetry Statistics");
	console.log("=".repeat(40));
	console.log(`Sessions:       ${stats.sessionCount}`);
	console.log(`Tool Calls:     ${stats.toolCallCount}`);
	console.log(`Tokens In:      ${stats.totalTokensIn.toLocaleString()}`);
	console.log(`Tokens Out:     ${stats.totalTokensOut.toLocaleString()}`);
	console.log(`Success Rate:   ${summary.successRate}%`);
	console.log("");
	console.log(`Engines Used:   ${summary.engines.join(", ") || "none"}`);
	console.log(`Modes Used:     ${summary.modes.join(", ") || "none"}`);
	console.log(`Tools Used:     ${summary.toolsUsed.slice(0, 5).join(", ") || "none"}`);
	if (summary.toolsUsed.length > 5) {
		console.log(`                ...and ${summary.toolsUsed.length - 5} more`);
	}

	if (stats.oldestTimestamp && stats.newestTimestamp) {
		const oldest = new Date(stats.oldestTimestamp).toLocaleDateString();
		const newest = new Date(stats.newestTimestamp).toLocaleDateString();
		console.log("");
		console.log(`Date Range:     ${oldest} - ${newest}`);
	}

	// List exports
	const exports = await listExports(outputDir);
	if (exports.length > 0) {
		console.log("");
		console.log("Available Exports:");
		for (const file of exports) {
			console.log(`  ${file}`);
		}
	}

	console.log("=".repeat(40));
}
