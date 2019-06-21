import { PvsProcess } from "./server/pvsProcess";
import { PvsResponseType, PvsVersionInfoResponseType, JsonType, ProofNodeType, ProofObjectType, PvsListProofStrategiesResponseType, StrategyDescriptor, PvsFindDeclarationResponseType } from "./server/common/serverInterface";
import * as fsUtils from "./server/common/fsUtils";
import * as test from "./test-costants";
import * as path from 'path';

const VERBOSE: boolean = false;
function log (data: any, opt?: { force?: boolean, stringify?: boolean, expanded?: boolean }): void {
	opt = opt || {};
	if (VERBOSE || opt.force) {
		if (opt.stringify) {
			if (opt.expanded) {
				console.log("\n", JSON.stringify(data, null, " "));
			} else {
				console.log("\n", JSON.stringify(data));
			}
		} else {
			console.log("\n", data);
		}
	}
}

describe("PvsProcess", async () => {
	log("PvsProcess");
	const pvsPath: string = "~/Work/pvs-snapshots/pvs-7.0-851/";

	it("constructor can create a pvs process", async () => {
		const proc: PvsProcess = new PvsProcess({ pvsPath });
		const success: boolean = await proc.pvs();
		expect(success).toBeDefined();
		const versionInfo: PvsResponseType = await proc.getPvsVersionInfo();
		expect(versionInfo).toBeDefined();
		expect(versionInfo.res).toBeDefined();
		log(versionInfo.res);
	});

	it("constructor can set context", async () => {
		const pvsContextFolder: string = "~/Work/";
		const proc: PvsProcess = new PvsProcess({ pvsPath, pvsContextFolder });
		await proc.pvs();
		const ctx: string = await proc.getContextFolder();
		log(`Current context: ${ctx}`);
		expect(ctx).toEqual(pvsContextFolder);
	});

	it("changeContext() can change context", async () => {
		const proc: PvsProcess = new PvsProcess({ pvsPath });
		await proc.pvs();
		const ctx: string = await proc.getContextFolder();
		log(`Current context: ${ctx}`);
		await proc.changeContext("..");
		const new_ctx: string = await proc.getContextFolder();
		log(`New context: ${new_ctx}`);
		expect(new_ctx).not.toEqual(ctx);
		const sup: string = `${ctx.split("/").slice(0, -2).join("/")}/`;
		expect(new_ctx).toEqual(sup);
	});

	it("restart() can restart pvs and keep same context folder", async () => {
		const proc: PvsProcess = new PvsProcess({ pvsPath });
		await proc.pvs();
		const ctx: string = await proc.getContextFolder();
		log(`Current context: ${ctx}`);
		await proc.restart();
		const ctx_after_restart: string = await proc.getContextFolder();
		log(`Context after restart: ${ctx_after_restart}`);
		expect(ctx_after_restart).toEqual(ctx);
	});

	it("getProcessID() can provide process ID", async () => {
		const proc: PvsProcess = new PvsProcess({ pvsPath });
		await proc.pvs();
		const pid: string = await proc.getProcessID();
		log(`Process ID: ${pid}`);
		expect(pid).toBeDefined();
	});

	it("kill() can kill a pvs process", async () => {
		const proc: PvsProcess = new PvsProcess({ pvsPath });
		await proc.pvs();
		const pid: string = await proc.getProcessID();
		log(`Process ID: ${pid}`);
		expect(pid).toBeDefined();
		const killed_pid: string = await proc.kill();
		log(`Killed process ID: ${killed_pid}`);
		expect(killed_pid).toBeDefined();
		expect(killed_pid).toEqual(pid);
	});

	it("getPvsPath can provide the path to the pvs executable", async () => {
		const proc: PvsProcess = new PvsProcess({ pvsPath });
		await proc.pvs();
		const _pvsPath: string = await proc.getPvsPath();
		log(`PVS path: ${_pvsPath}`);
		expect(_pvsPath).toBeDefined();
	});

	it("getPvsLibraryPath can provide library path", async () => {
		const proc: PvsProcess = new PvsProcess({ pvsPath });
		await proc.pvs();
		const lib: string = await proc.getPvsLibraryPath();
		log(`Library path: ${lib}`);
		expect(lib).toBeDefined();
		expect(lib).toEqual(path.join(fsUtils.tildeExpansion(pvsPath), "lib"))
	});

	it("prf2json() can translate .prf files into JSON objects", async () => {
		test.proof_tactics.forEach(tactic => {
			const res: ProofObjectType = PvsProcess.prf2json(tactic, "test");
			expect(res).toBeDefined();
			expect(res.proof).toBeDefined();
			expect(res.proof.id).toBeDefined();
			expect(res.proof.type).toEqual("root");
			expect(res.proof.children).toBeDefined();
			log(res);
		});
	});

	it("getPvsVersionInfo() can print pvs version info as a JSON objects", async () => {
		const proc: PvsProcess = new PvsProcess({ pvsPath });
		await proc.pvs();
		const version: PvsVersionInfoResponseType = await proc.getPvsVersionInfo();
		log(version);
		expect(version).toBeDefined();
		expect(version.res).toBeDefined();
		expect(version.res.pvsVersion).toBeDefined();
		expect(version.res.lispVersion).toBeDefined();
	});

	it("listProofStrategies() can print proof strategies", async () => {
		const proc: PvsProcess = new PvsProcess({ pvsPath });
		await proc.pvs();
		const strategies: PvsListProofStrategiesResponseType = await proc.listProofStrategies();
		expect(strategies).toBeDefined();
		expect(strategies.res).toBeDefined();
		log(strategies.res);
		strategies.res.forEach((strategy: StrategyDescriptor) => {
			expect(strategy.description).toBeDefined();
			expect(strategy.name).toBeDefined();
		});
	});

	it("findDeclaration() can find declarations from the prelude", async () => {
		const proc: PvsProcess = new PvsProcess({ pvsPath });
		await proc.pvs();
		const declarations: PvsFindDeclarationResponseType = await proc.findDeclaration("real");
		expect(declarations).toBeDefined();
		expect(declarations.res).toBeDefined();
		log(declarations.res);
		expect(Object.keys(declarations.res).length).toEqual(1);
		Object.keys(declarations.res).forEach((key: string) => {
			// key is in the form theoryName.symbolName
			expect(declarations.res[key].symbolDeclaration).toBeDefined();
			expect(declarations.res[key].symbolDeclarationFile).toBeDefined();
			expect(declarations.res[key].symbolDeclarationRange).toBeDefined();
			expect(declarations.res[key].symbolName).toBeDefined();
			expect(declarations.res[key].symbolTheory).toBeDefined();
		});
	});
});
