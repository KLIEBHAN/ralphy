import type { RuntimeOptions } from "../../config/types.ts";
import { logTaskProgress } from "../../config/writer.ts";
import { createEngine, isEngineAvailable } from "../../engines/index.ts";
import type { AIEngineName } from "../../engines/types.ts";
import { isBrowserAvailable } from "../../execution/browser.ts";
import { buildPrompt } from "../../execution/prompt.ts";
import { isFatalError, isRetryableError, withRetry } from "../../execution/retry.ts";
import { formatTokens, logError, logInfo, setVerbose } from "../../ui/logger.ts";
import { notifyTaskComplete, notifyTaskFailed } from "../../ui/notify.ts";
import { buildActiveSettings } from "../../ui/settings.ts";
import { ProgressSpinner } from "../../ui/spinner.ts";

export interface TaskRunResult {
	success: boolean;
	fatal: boolean;
	error?: string;
}

/**
 * Run a single task (brownfield mode)
 */
export async function runTask(task: string, options: RuntimeOptions): Promise<TaskRunResult> {
	const workDir = process.cwd();

	// Set verbose mode
	setVerbose(options.verbose);

	// Check engine availability
	const engine = createEngine(options.aiEngine as AIEngineName);
	const available = await isEngineAvailable(options.aiEngine as AIEngineName);

	if (!available) {
		const error = `${engine.name} CLI not found. Make sure '${engine.cliCommand}' is in your PATH.`;
		logError(error);
		return { success: false, fatal: true, error };
	}

	logInfo(`Running task with ${engine.name}...`);

	// Check browser availability
	if (isBrowserAvailable(options.browserEnabled)) {
		logInfo("Browser automation enabled (agent-browser)");
	}

	// Build prompt
	const prompt = buildPrompt({
		task,
		autoCommit: options.autoCommit,
		workDir,
		browserEnabled: options.browserEnabled,
		skipTests: options.skipTests,
		skipLint: options.skipLint,
	});

	// Build active settings for display
	const activeSettings = buildActiveSettings(options);

	// Execute with spinner
	const spinner = new ProgressSpinner(task, activeSettings);

	if (options.dryRun) {
		spinner.success("(dry run) Would execute task");
		console.log("\nPrompt:");
		console.log(prompt);
		return { success: true, fatal: false };
	}

	try {
		const result = await withRetry(
			async () => {
				spinner.updateStep("Working");

				// Build engine options
				const engineOptions = {
					...(options.modelOverride && { modelOverride: options.modelOverride }),
					...(options.engineArgs &&
						options.engineArgs.length > 0 && { engineArgs: options.engineArgs }),
				};

				// Use streaming if available
				if (engine.executeStreaming) {
					return await engine.executeStreaming(
						prompt,
						workDir,
						(step) => {
							spinner.updateStep(step);
						},
						engineOptions,
					);
				}

				const res = await engine.execute(prompt, workDir, engineOptions);

				if (!res.success && res.error && isRetryableError(res.error)) {
					throw new Error(res.error);
				}

				return res;
			},
			{
				maxRetries: options.maxRetries,
				retryDelay: options.retryDelay,
				onRetry: (attempt) => {
					spinner.updateStep(`Retry ${attempt}`);
				},
			},
		);

		if (result.success) {
			const tokens = formatTokens(result.inputTokens, result.outputTokens);
			spinner.success(`Done ${tokens}`);

			logTaskProgress(task, "completed", workDir);
			if (options.repeatCount === 1) {
				notifyTaskComplete(task);
			}

			// Show response summary
			if (result.response && result.response !== "Task completed") {
				console.log("\nResult:");
				console.log(result.response.slice(0, 500));
				if (result.response.length > 500) {
					console.log("...");
				}
			}
			return { success: true, fatal: false };
		}

		const errorMsg = result.error || "Unknown error";
		const fatal = isFatalError(errorMsg);
		spinner.error(errorMsg);
		logTaskProgress(task, "failed", workDir);
		if (options.repeatCount === 1) {
			notifyTaskFailed(task, errorMsg);
		}
		return { success: false, fatal, error: errorMsg };
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		const fatal = isFatalError(errorMsg);
		spinner.error(errorMsg);
		logTaskProgress(task, "failed", workDir);
		if (options.repeatCount === 1) {
			notifyTaskFailed(task, errorMsg);
		}
		return { success: false, fatal, error: errorMsg };
	}
}
