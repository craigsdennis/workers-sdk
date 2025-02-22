import * as fs from "fs";
import { findUpSync } from "find-up";
import { getEntry } from "./deployment-bundle/entry";
import { UserError } from "./errors";
import { logger } from "./logger";
import type { Config } from "./config";
import type { CfScriptFormat } from "./deployment-bundle/worker";

// Currently includes bindings & rules for declaring modules

export async function generateTypes(
	configToDTS: Partial<Config>,
	config: Config
) {
	const configContainsEntryPoint =
		config.main !== undefined || !!config.site?.["entry-point"];

	const entrypointFormat: CfScriptFormat = configContainsEntryPoint
		? (await getEntry({}, config, "types")).format
		: "modules";

	const envTypeStructure: string[] = [];

	if (configToDTS.kv_namespaces) {
		for (const kvNamespace of configToDTS.kv_namespaces) {
			envTypeStructure.push(`${kvNamespace.binding}: KVNamespace;`);
		}
	}

	if (configToDTS.vars) {
		for (const varName in configToDTS.vars) {
			const varValue = configToDTS.vars[varName];
			if (
				typeof varValue === "string" ||
				typeof varValue === "number" ||
				typeof varValue === "boolean"
			) {
				envTypeStructure.push(`${varName}: "${varValue}";`);
			}
			if (typeof varValue === "object" && varValue !== null) {
				envTypeStructure.push(`${varName}: ${JSON.stringify(varValue)};`);
			}
		}
	}

	if (configToDTS.durable_objects?.bindings) {
		for (const durableObject of configToDTS.durable_objects.bindings) {
			envTypeStructure.push(`${durableObject.name}: DurableObjectNamespace;`);
		}
	}

	if (configToDTS.r2_buckets) {
		for (const R2Bucket of configToDTS.r2_buckets) {
			envTypeStructure.push(`${R2Bucket.binding}: R2Bucket;`);
		}
	}

	if (configToDTS.d1_databases) {
		for (const d1 of configToDTS.d1_databases) {
			envTypeStructure.push(`${d1.binding}: D1Database;`);
		}
	}

	if (configToDTS.services) {
		for (const service of configToDTS.services) {
			envTypeStructure.push(`${service.binding}: Fetcher;`);
		}
	}

	if (configToDTS.constellation) {
		for (const service of configToDTS.constellation) {
			envTypeStructure.push(`${service.binding}: Fetcher;`);
		}
	}

	if (configToDTS.analytics_engine_datasets) {
		for (const analyticsEngine of configToDTS.analytics_engine_datasets) {
			envTypeStructure.push(
				`${analyticsEngine.binding}: AnalyticsEngineDataset;`
			);
		}
	}

	if (configToDTS.dispatch_namespaces) {
		for (const namespace of configToDTS.dispatch_namespaces) {
			envTypeStructure.push(`${namespace.binding}: DispatchNamespace;`);
		}
	}

	if (configToDTS.logfwdr?.bindings?.length) {
		envTypeStructure.push(`LOGFWDR_SCHEMA: any;`);
	}

	if (configToDTS.data_blobs) {
		for (const dataBlobs in configToDTS.data_blobs) {
			envTypeStructure.push(`${dataBlobs}: ArrayBuffer;`);
		}
	}

	if (configToDTS.text_blobs) {
		for (const textBlobs in configToDTS.text_blobs) {
			envTypeStructure.push(`${textBlobs}: string;`);
		}
	}

	if (configToDTS.unsafe?.bindings) {
		for (const unsafe of configToDTS.unsafe.bindings) {
			envTypeStructure.push(`${unsafe.name}: any;`);
		}
	}

	if (configToDTS.queues) {
		if (configToDTS.queues.producers) {
			for (const queue of configToDTS.queues.producers) {
				envTypeStructure.push(`${queue.binding}: Queue;`);
			}
		}
	}

	const modulesTypeStructure: string[] = [];
	if (configToDTS.rules) {
		const moduleTypeMap = {
			Text: "string",
			Data: "ArrayBuffer",
			CompiledWasm: "WebAssembly.Module",
		};
		for (const ruleObject of configToDTS.rules) {
			const typeScriptType =
				moduleTypeMap[ruleObject.type as keyof typeof moduleTypeMap];
			if (typeScriptType !== undefined) {
				ruleObject.globs.forEach((glob) => {
					modulesTypeStructure.push(`declare module "*.${glob
						.split(".")
						.at(-1)}" {
	const value: ${typeScriptType};
	export default value;
}`);
				});
			}
		}
	}

	writeDTSFile({
		envTypeStructure,
		modulesTypeStructure,
		formatType: entrypointFormat,
	});
}

function writeDTSFile({
	envTypeStructure,
	modulesTypeStructure,
	formatType,
}: {
	envTypeStructure: string[];
	modulesTypeStructure: string[];
	formatType: CfScriptFormat;
}) {
	const wranglerOverrideDTSPath = findUpSync("worker-configuration.d.ts");
	try {
		if (
			wranglerOverrideDTSPath !== undefined &&
			!fs
				.readFileSync(wranglerOverrideDTSPath, "utf8")
				.includes("Generated by Wrangler")
		) {
			throw new UserError(
				"A non-wrangler worker-configuration.d.ts already exists, please rename and try again."
			);
		}
	} catch (error) {
		if (error instanceof Error && !error.message.includes("not found")) {
			throw error;
		}
	}

	let combinedTypeStrings = "";
	if (formatType === "modules") {
		combinedTypeStrings += `interface Env {\n${envTypeStructure
			.map((value) => `\t${value}`)
			.join("\n")}\n}\n${modulesTypeStructure.join("\n")}`;
	} else {
		combinedTypeStrings += `export {};\ndeclare global {\n${envTypeStructure
			.map((value) => `\tconst ${value}`)
			.join("\n")}\n}\n${modulesTypeStructure.join("\n")}`;
	}

	if (envTypeStructure.length || modulesTypeStructure.length) {
		fs.writeFileSync(
			"worker-configuration.d.ts",
			`// Generated by Wrangler on ${new Date()}` + "\n" + combinedTypeStrings
		);
		logger.log(combinedTypeStrings);
	}
}
