import { realpathSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve, join, parse, basename } from "node:path";
import { pathToFileURL } from "node:url";

import { installTreeXNativePatches } from "./src/treex-component.js";

const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";

function findPiPackageRoot(startPath: string): string | undefined {
	let current: string;
	try {
		current = dirname(realpathSync(startPath));
	} catch {
		return undefined;
	}
	const filesystemRoot = parse(current).root;
	while (current !== filesystemRoot) {
		const packagePath = join(current, "package.json");
		if (existsSync(packagePath)) {
			try {
				const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as {
					name?: string;
				};
				if (manifest.name === PI_PACKAGE_NAME) return current;
			} catch {
				// Keep walking: a malformed unrelated package must not select a host.
			}
		}
		current = dirname(current);
	}
	return undefined;
}

// Pi 0.84.3 moved its Node CLI entrypoint into a bundled runtime. The CLI now
// executes from a hashed bundle chunk that imports `main` (and exports the live
// InteractiveMode + component classes), while dist/index.js still exports a
// separate modular class identity. We must patch/consume the bundled class, not
// the modular one, or our changes never reach the running session.
function findBundledRuntimeModule(
	entrypoint: string,
	packageRoot: string,
): string | undefined {
	let resolvedEntrypoint: string;
	let source: string;
	try {
		resolvedEntrypoint = realpathSync(entrypoint);
		source = readFileSync(resolvedEntrypoint, "utf8");
	} catch {
		return undefined;
	}

	// Pi 0.86 wraps the bundled ESM launcher in a createRequire bootstrap. Follow
	// that local file without executing it or leaving this Pi package. A target
	// that is missing, unreadable, or out of package keeps the launcher's own
	// source, so the direct-import scan below still runs.
	const bootstrap = source.match(
		/\bcreateRequire\s*\(\s*import\.meta\.url\s*\)\s*\(\s*["'](\.[^"']+)["']\s*\)/,
	);
	if (bootstrap) {
		try {
			const runtime = realpathSync(join(dirname(resolvedEntrypoint), bootstrap[1]));
			if (findPiPackageRoot(runtime) === packageRoot) {
				const runtimeSource = readFileSync(runtime, "utf8");
				resolvedEntrypoint = runtime;
				source = runtimeSource;
			}
		} catch {
			// Keep the launcher source and fall through to the direct imports.
		}
	}

	const namedImport = /\bimport\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
	for (const match of source.matchAll(namedImport)) {
		const names = match[1]
			.split(",")
			.map((name) => name.trim().split(/\s+as\s+/)[0]);
		const specifier = match[2];
		if (!names.includes("main") || !specifier.startsWith(".")) continue;

		try {
			const candidate = realpathSync(join(dirname(resolvedEntrypoint), specifier));
			if (findPiPackageRoot(candidate) === packageRoot) return candidate;
		} catch {
			// Keep searching other named imports before falling back to dist/index.js.
		}
	}

	return undefined;
}

// Walk up from the CLI entrypoint to the real dist root so sibling modules
// resolve correctly whether the entrypoint is dist/cli.js or dist/bundle/cli.js.
function getHostDistDir() {
	let dir = dirname(realpathSync(process.argv[1]));
	while (dirname(dir) !== dir && basename(dir) !== "dist") dir = dirname(dir);
	return dir;
}

type HostModules = {
	InteractiveMode: new (...args: any[]) => any;
	components: Record<string, any>;
};

async function resolveHostModules(): Promise<HostModules> {
	const entrypoint = process.argv[1];

	const packageRoots = new Set<string>();
	const hostPaths = new Set<string>();
	if (entrypoint) hostPaths.add(entrypoint);
	for (const hostPath of hostPaths) {
		const root = findPiPackageRoot(hostPath);
		if (root) packageRoots.add(root);
	}

	for (const packageRoot of packageRoots) {
		for (const hostPath of hostPaths) {
			if (findPiPackageRoot(hostPath) !== packageRoot) continue;
			const bundledRuntime = findBundledRuntimeModule(hostPath, packageRoot);
			if (bundledRuntime) {
				const mod = (await import(pathToFileURL(bundledRuntime).href)) as Record<
					string,
					any
				>;
				if (mod.InteractiveMode && mod.AssistantMessageComponent) {
					return { InteractiveMode: mod.InteractiveMode, components: mod };
				}
			}
		}
	}

	// Fallback: modular dist layout (older Pi versions, library hosts).
	const distDir = getHostDistDir();
	const [indexMod, components] = await Promise.all([
		import(pathToFileURL(resolve(distDir, "index.js")).href) as Promise<
			Record<string, any>
		>,
		import(
			pathToFileURL(resolve(distDir, "modes/interactive/components/index.js")).href
		) as Promise<Record<string, any>>,
	]);
	return { InteractiveMode: indexMod.InteractiveMode, components };
}

export default async function treeXExtension(pi: any) {
	const { InteractiveMode, components } = await resolveHostModules();

	const unpatch = installTreeXNativePatches(InteractiveMode, {
		assistantMessageComponent: components.AssistantMessageComponent,
		bashExecutionComponent: components.BashExecutionComponent,
		branchSummaryMessageComponent: components.BranchSummaryMessageComponent,
		compactionSummaryMessageComponent: components.CompactionSummaryMessageComponent,
		customMessageComponent: components.CustomMessageComponent,
		toolExecutionComponent: components.ToolExecutionComponent,
		userMessageComponent: components.UserMessageComponent,
	});

	pi.on("session_shutdown", unpatch);
}
