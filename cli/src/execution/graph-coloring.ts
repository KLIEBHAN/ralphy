import type { Task } from "../tasks/types.ts";
import { calculateFileOverlap, type TaskScope } from "./planning.ts";

/**
 * A node in the task dependency graph
 */
interface GraphNode {
	task: Task;
	scope: TaskScope;
	color: number; // -1 means uncolored
	adjacentColors: Set<number>; // Colors used by adjacent nodes
	degree: number; // Number of edges
}

/**
 * An edge in the task dependency graph (represents potential conflict)
 */
interface GraphEdge {
	task1Id: string;
	task2Id: string;
	weight: number; // Overlap/conflict score
}

/**
 * Task dependency graph for scheduling
 */
export interface TaskGraph {
	nodes: Map<string, GraphNode>;
	edges: GraphEdge[];
}

/**
 * Build a task dependency graph based on file overlap.
 * Tasks that modify the same files are connected with weighted edges.
 */
export function buildTaskGraph(
	tasks: Task[],
	scopes: Map<string, TaskScope>,
	conflictThreshold = 1,
): TaskGraph {
	const nodes = new Map<string, GraphNode>();
	const edges: GraphEdge[] = [];

	// Create nodes
	for (const task of tasks) {
		const scope = scopes.get(task.id) || {
			likelyFiles: [],
			possibleFiles: [],
			readOnlyDirs: [],
		};

		nodes.set(task.id, {
			task,
			scope,
			color: -1,
			adjacentColors: new Set(),
			degree: 0,
		});
	}

	// Create edges based on file overlap
	for (let i = 0; i < tasks.length; i++) {
		for (let j = i + 1; j < tasks.length; j++) {
			const task1 = tasks[i];
			const task2 = tasks[j];
			const scope1 = scopes.get(task1.id);
			const scope2 = scopes.get(task2.id);

			if (scope1 && scope2) {
				const overlap = calculateFileOverlap(scope1, scope2);

				if (overlap >= conflictThreshold) {
					edges.push({
						task1Id: task1.id,
						task2Id: task2.id,
						weight: overlap,
					});

					// Update degrees
					const node1 = nodes.get(task1.id);
					const node2 = nodes.get(task2.id);
					if (node1) node1.degree++;
					if (node2) node2.degree++;
				}
			}
		}
	}

	return { nodes, edges };
}

/**
 * Calculate saturation degree for a node.
 * Saturation = number of different colors used by adjacent nodes.
 */
function getSaturation(node: GraphNode): number {
	return node.adjacentColors.size;
}

/**
 * Find the uncolored node with highest saturation degree.
 * Ties are broken by selecting the node with highest degree.
 */
function selectNextNode(nodes: Map<string, GraphNode>): GraphNode | null {
	let bestNode: GraphNode | null = null;
	let bestSaturation = -1;
	let bestDegree = -1;

	for (const node of nodes.values()) {
		if (node.color !== -1) continue; // Already colored

		const saturation = getSaturation(node);

		if (
			saturation > bestSaturation ||
			(saturation === bestSaturation && node.degree > bestDegree)
		) {
			bestNode = node;
			bestSaturation = saturation;
			bestDegree = node.degree;
		}
	}

	return bestNode;
}

/**
 * Get the lowest available color for a node.
 */
function getLowestAvailableColor(node: GraphNode): number {
	let color = 0;
	while (node.adjacentColors.has(color)) {
		color++;
	}
	return color;
}

/**
 * Update adjacent colors after coloring a node.
 */
function updateAdjacentColors(
	coloredNode: GraphNode,
	graph: TaskGraph,
): void {
	for (const edge of graph.edges) {
		let adjacentId: string | null = null;

		if (edge.task1Id === coloredNode.task.id) {
			adjacentId = edge.task2Id;
		} else if (edge.task2Id === coloredNode.task.id) {
			adjacentId = edge.task1Id;
		}

		if (adjacentId) {
			const adjacentNode = graph.nodes.get(adjacentId);
			if (adjacentNode && adjacentNode.color === -1) {
				adjacentNode.adjacentColors.add(coloredNode.color);
			}
		}
	}
}

/**
 * Color the graph using DSatur algorithm.
 * Returns the number of colors used (chromatic number approximation).
 */
export function colorGraph(graph: TaskGraph): number {
	let maxColor = -1;

	// Color nodes one by one
	while (true) {
		const node = selectNextNode(graph.nodes);
		if (!node) break; // All nodes colored

		const color = getLowestAvailableColor(node);
		node.color = color;
		maxColor = Math.max(maxColor, color);

		updateAdjacentColors(node, graph);
	}

	return maxColor + 1; // Number of colors used
}

/**
 * Group tasks by color (batch).
 * Tasks with the same color can run in parallel without conflicts.
 */
export function groupTasksByColor(graph: TaskGraph): Task[][] {
	const colorGroups = new Map<number, Task[]>();

	for (const node of graph.nodes.values()) {
		const group = colorGroups.get(node.color) || [];
		group.push(node.task);
		colorGroups.set(node.color, group);
	}

	// Sort by color (process lower colors first)
	const sortedColors = Array.from(colorGroups.keys()).sort((a, b) => a - b);

	return sortedColors.map((color) => colorGroups.get(color) || []);
}

/**
 * Schedule tasks using DSatur graph coloring.
 *
 * This minimizes conflicts by:
 * 1. Building a graph where edges represent potential conflicts (file overlap)
 * 2. Coloring the graph so adjacent nodes have different colors
 * 3. Grouping tasks by color - tasks with same color can run in parallel
 *
 * Returns batches of tasks that can be run in parallel without conflicts.
 */
export function scheduleTasksWithDSatur(
	tasks: Task[],
	scopes: Map<string, TaskScope>,
	maxParallel: number,
): Task[][] {
	if (tasks.length === 0) return [];
	if (tasks.length === 1) return [tasks];

	// Build dependency graph
	const graph = buildTaskGraph(tasks, scopes);

	// Color the graph
	const numColors = colorGraph(graph);

	// Group by color
	let batches = groupTasksByColor(graph);

	// Further split batches if they exceed maxParallel
	const finalBatches: Task[][] = [];
	for (const batch of batches) {
		if (batch.length <= maxParallel) {
			finalBatches.push(batch);
		} else {
			// Split into smaller batches
			for (let i = 0; i < batch.length; i += maxParallel) {
				finalBatches.push(batch.slice(i, i + maxParallel));
			}
		}
	}

	return finalBatches;
}

/**
 * Get scheduling statistics for logging.
 */
export function getSchedulingStats(
	graph: TaskGraph,
	batches: Task[][],
): {
	totalTasks: number;
	totalBatches: number;
	chromaticNumber: number;
	maxBatchSize: number;
	conflictEdges: number;
} {
	return {
		totalTasks: graph.nodes.size,
		totalBatches: batches.length,
		chromaticNumber: new Set(Array.from(graph.nodes.values()).map((n) => n.color)).size,
		maxBatchSize: Math.max(...batches.map((b) => b.length), 0),
		conflictEdges: graph.edges.length,
	};
}
