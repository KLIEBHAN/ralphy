import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { AIEngine } from "../engines/types.ts";
import type { Task } from "../tasks/types.ts";
import { logDebug } from "../ui/logger.ts";

/**
 * Predicted scope of files a task will modify
 */
export interface TaskScope {
	/** Files that will likely be modified */
	likelyFiles: string[];
	/** Files that might be modified */
	possibleFiles: string[];
	/** Read-only directories (dependencies) */
	readOnlyDirs: string[];
}

/**
 * Default read-only directories that are never modified by tasks
 */
const DEFAULT_READONLY_DIRS = [
	"node_modules",
	".git",
	"vendor",
	".venv",
	"venv",
	"__pycache__",
	".pnpm-store",
	".yarn",
	"target",
	"build",
	"dist",
	".next",
	".nuxt",
	".output",
	".cache",
];

/**
 * Get a simplified project structure for the LLM prompt.
 * Excludes node_modules and other large directories.
 */
export function getProjectStructure(
	workDir: string,
	maxDepth = 3,
	excludeDirs = DEFAULT_READONLY_DIRS,
): string[] {
	const files: string[] = [];

	function scan(dir: string, depth: number) {
		if (depth > maxDepth) return;

		try {
			const items = readdirSync(dir);

			for (const item of items) {
				// Skip hidden files and excluded directories
				if (item.startsWith(".") && item !== ".ralphy") continue;
				if (excludeDirs.includes(item)) continue;

				const fullPath = join(dir, item);
				const relPath = relative(workDir, fullPath);

				try {
					const stat = statSync(fullPath);

					if (stat.isDirectory()) {
						files.push(`${relPath}/`);
						scan(fullPath, depth + 1);
					} else if (stat.isFile()) {
						files.push(relPath);
					}
				} catch {
					// Skip files we can't stat
				}
			}
		} catch {
			// Skip directories we can't read
		}
	}

	scan(workDir, 0);
	return files.slice(0, 200); // Limit to 200 files to keep prompt manageable
}

/**
 * Build a prompt for the LLM to predict file scope.
 */
function buildScopePredictionPrompt(task: Task, projectFiles: string[]): string {
	return `Given this coding task and project structure, predict which files will be modified.

## Task
${task.title}
${task.body ? `\nDetails: ${task.body}` : ""}

## Project Files
${projectFiles.join("\n")}

## Instructions
Analyze the task and predict:
1. likelyFiles: Files that will definitely need to be modified
2. possibleFiles: Files that might need to be modified
3. readOnlyDirs: Directories that contain dependencies (node_modules, vendor, etc.)

Respond with ONLY valid JSON in this exact format:
{
  "likelyFiles": ["src/file1.ts", "src/file2.ts"],
  "possibleFiles": ["src/utils/helper.ts"],
  "readOnlyDirs": ["node_modules", ".git"]
}

Keep predictions minimal - only include files directly related to the task.`;
}

/**
 * Parse the LLM response to extract TaskScope.
 */
function parseScopeResponse(response: string): TaskScope | null {
	try {
		// Try to extract JSON from the response
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		if (!jsonMatch) return null;

		const parsed = JSON.parse(jsonMatch[0]);

		return {
			likelyFiles: Array.isArray(parsed.likelyFiles) ? parsed.likelyFiles : [],
			possibleFiles: Array.isArray(parsed.possibleFiles) ? parsed.possibleFiles : [],
			readOnlyDirs: Array.isArray(parsed.readOnlyDirs)
				? parsed.readOnlyDirs
				: DEFAULT_READONLY_DIRS,
		};
	} catch {
		return null;
	}
}

/**
 * Use LLM to predict which files a task will modify.
 *
 * This can be used to:
 * 1. Create more targeted sandboxes (only copy likely modified files)
 * 2. Detect potential conflicts between parallel tasks
 * 3. Optimize batch scheduling
 */
export async function predictTaskScope(
	task: Task,
	engine: AIEngine,
	workDir: string,
	modelOverride?: string,
): Promise<TaskScope> {
	const projectFiles = getProjectStructure(workDir);
	const prompt = buildScopePredictionPrompt(task, projectFiles);

	try {
		const engineOptions = modelOverride ? { modelOverride } : undefined;
		const result = await engine.execute(prompt, workDir, engineOptions);

		if (result.success && result.response) {
			const scope = parseScopeResponse(result.response);
			if (scope) {
				logDebug(`Predicted scope for "${task.title}": ${scope.likelyFiles.length} likely, ${scope.possibleFiles.length} possible`);
				return scope;
			}
		}
	} catch (error) {
		logDebug(`Failed to predict scope for "${task.title}": ${error}`);
	}

	// Return default scope if prediction fails
	return {
		likelyFiles: [],
		possibleFiles: [],
		readOnlyDirs: DEFAULT_READONLY_DIRS,
	};
}

/**
 * Predict scopes for multiple tasks in parallel.
 */
export async function predictTaskScopes(
	tasks: Task[],
	engine: AIEngine,
	workDir: string,
	modelOverride?: string,
): Promise<Map<string, TaskScope>> {
	const scopes = new Map<string, TaskScope>();

	// Run predictions in parallel (they're independent)
	const predictions = await Promise.all(
		tasks.map(async (task) => {
			const scope = await predictTaskScope(task, engine, workDir, modelOverride);
			return { taskId: task.id, scope };
		}),
	);

	for (const { taskId, scope } of predictions) {
		scopes.set(taskId, scope);
	}

	return scopes;
}

/**
 * Calculate file overlap between two task scopes.
 * Higher overlap = higher conflict likelihood.
 */
export function calculateFileOverlap(scope1: TaskScope, scope2: TaskScope): number {
	const files1 = new Set([...scope1.likelyFiles, ...scope1.possibleFiles]);
	const files2 = new Set([...scope2.likelyFiles, ...scope2.possibleFiles]);

	let overlap = 0;
	for (const file of files1) {
		if (files2.has(file)) {
			// Weight likely files higher
			const weight1 = scope1.likelyFiles.includes(file) ? 2 : 1;
			const weight2 = scope2.likelyFiles.includes(file) ? 2 : 1;
			overlap += weight1 + weight2;
		}
	}

	return overlap;
}
