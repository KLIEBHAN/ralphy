import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { slugify } from "./branch.ts";

/**
 * Create a worktree for parallel agent execution
 */
export async function createAgentWorktree(
	taskName: string,
	agentNum: number,
	baseBranch: string,
	worktreeBase: string,
	originalDir: string
): Promise<{ worktreeDir: string; branchName: string }> {
	// Include timestamp to ensure unique branch names across batches
	const timestamp = Date.now();
	const branchName = `ralphy/agent-${agentNum}-${timestamp}-${slugify(taskName)}`;
	const worktreeDir = join(worktreeBase, `agent-${agentNum}`);

	const git: SimpleGit = simpleGit(originalDir);

	// Prune stale worktrees to clean up any orphaned/missing references
	await git.raw(["worktree", "prune"]);

	// Remove existing worktree if any (must be done BEFORE creating new one)
	try {
		await git.raw(["worktree", "remove", "-f", worktreeDir]);
	} catch {
		// Worktree might not exist in git's registry
	}

	// Remove directory if it exists (handles edge cases)
	if (existsSync(worktreeDir)) {
		rmSync(worktreeDir, { recursive: true, force: true });
	}

	// Prune again after removal
	await git.raw(["worktree", "prune"]);

	// Create branch and worktree atomically with -B (create or reset branch)
	// -B eliminates need for separate branch deletion
	await git.raw(["worktree", "add", "-f", "-B", branchName, worktreeDir, baseBranch]);

	return { worktreeDir, branchName };
}

/**
 * Cleanup a worktree after agent completes
 */
export async function cleanupAgentWorktree(
	worktreeDir: string,
	branchName: string,
	originalDir: string
): Promise<{ leftInPlace: boolean }> {
	// Check for uncommitted changes
	if (existsSync(worktreeDir)) {
		const worktreeGit = simpleGit(worktreeDir);
		const status = await worktreeGit.status();

		if (status.files.length > 0) {
			// Leave worktree in place due to uncommitted changes
			return { leftInPlace: true };
		}
	}

	// Remove the worktree
	const git: SimpleGit = simpleGit(originalDir);
	try {
		await git.raw(["worktree", "remove", "-f", worktreeDir]);
	} catch {
		// Ignore removal errors
	}

	// Don't delete branch - it may have commits we want to keep/PR
	return { leftInPlace: false };
}

/**
 * Get worktree base directory (creates if needed)
 */
export function getWorktreeBase(workDir: string): string {
	const worktreeBase = join(workDir, ".ralphy-worktrees");
	if (!existsSync(worktreeBase)) {
		mkdirSync(worktreeBase, { recursive: true });
	}
	return worktreeBase;
}

/**
 * List all ralphy worktrees
 */
export async function listWorktrees(workDir: string): Promise<string[]> {
	const git: SimpleGit = simpleGit(workDir);
	const output = await git.raw(["worktree", "list", "--porcelain"]);

	const worktrees: string[] = [];
	const lines = output.split("\n");

	for (const line of lines) {
		if (line.startsWith("worktree ") && line.includes(".ralphy-worktrees")) {
			worktrees.push(line.replace("worktree ", ""));
		}
	}

	return worktrees;
}

/**
 * Clean up all ralphy worktrees
 */
export async function cleanupAllWorktrees(workDir: string): Promise<void> {
	const git: SimpleGit = simpleGit(workDir);
	const worktrees = await listWorktrees(workDir);

	for (const worktree of worktrees) {
		try {
			await git.raw(["worktree", "remove", "-f", worktree]);
		} catch {
			// Ignore errors
		}
	}

	// Prune any stale worktrees
	await git.raw(["worktree", "prune"]);
}
