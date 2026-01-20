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
	const branchName = `ralphy/agent-${agentNum}-${slugify(taskName)}`;
	const worktreeDir = join(worktreeBase, `agent-${agentNum}`);

	const git: SimpleGit = simpleGit(originalDir);

	// FIRST: Prune stale worktrees to clean up any orphaned/missing references
	// This handles the case where directory was deleted but git still has it registered
	await git.raw(["worktree", "prune"]);

	// Remove existing worktree if any (must be done BEFORE deleting branch)
	// The branch cannot be deleted while it's checked out in a worktree
	try {
		await git.raw(["worktree", "remove", "-f", worktreeDir]);
	} catch {
		// Worktree might not exist in git's registry, that's fine
	}

	// Also remove the directory if it exists (handles edge cases)
	if (existsSync(worktreeDir)) {
		rmSync(worktreeDir, { recursive: true, force: true });
	}

	// Prune again after removal to ensure clean state
	await git.raw(["worktree", "prune"]);

	// Now we can safely delete the branch if it exists
	try {
		await git.deleteLocalBranch(branchName, true);
	} catch {
		// Branch might not exist, or try raw command as fallback
		try {
			await git.raw(["branch", "-D", branchName]);
		} catch {
			// Branch doesn't exist, that's fine
		}
	}

	// Create branch from base
	await git.branch([branchName, baseBranch]);

	// Create worktree with -f flag to force in case of any lingering state
	await git.raw(["worktree", "add", "-f", worktreeDir, branchName]);

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
