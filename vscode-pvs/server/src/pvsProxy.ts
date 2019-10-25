/**
 * @module xmlrpcProxy
 * @author Paolo Masci
 * @date 2019.06.18
 * @copyright 
 * Copyright 2019 United States Government as represented by the Administrator 
 * of the National Aeronautics and Space Administration. All Rights Reserved.
 *
 * Disclaimers
 *
 * No Warranty: THE SUBJECT SOFTWARE IS PROVIDED "AS IS" WITHOUT ANY
 * WARRANTY OF ANY KIND, EITHER EXPRESSED, IMPLIED, OR STATUTORY,
 * INCLUDING, BUT NOT LIMITED TO, ANY WARRANTY THAT THE SUBJECT SOFTWARE
 * WILL CONFORM TO SPECIFICATIONS, ANY IMPLIED WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR FREEDOM FROM
 * INFRINGEMENT, ANY WARRANTY THAT THE SUBJECT SOFTWARE WILL BE ERROR
 * FREE, OR ANY WARRANTY THAT DOCUMENTATION, IF PROVIDED, WILL CONFORM TO
 * THE SUBJECT SOFTWARE. THIS AGREEMENT DOES NOT, IN ANY MANNER,
 * CONSTITUTE AN ENDORSEMENT BY GOVERNMENT AGENCY OR ANY PRIOR RECIPIENT
 * OF ANY RESULTS, RESULTING DESIGNS, HARDWARE, SOFTWARE PRODUCTS OR ANY
 * OTHER APPLICATIONS RESULTING FROM USE OF THE SUBJECT SOFTWARE.
 * FURTHER, GOVERNMENT AGENCY DISCLAIMS ALL WARRANTIES AND LIABILITIES
 * REGARDING THIRD-PARTY SOFTWARE, IF PRESENT IN THE ORIGINAL SOFTWARE,
 * AND DISTRIBUTES IT "AS IS."
 *
 * Waiver and Indemnity: RECIPIENT AGREES TO WAIVE ANY AND ALL CLAIMS
 * AGAINST THE UNITED STATES GOVERNMENT, ITS CONTRACTORS AND
 * SUBCONTRACTORS, AS WELL AS ANY PRIOR RECIPIENT.  IF RECIPIENT'S USE OF
 * THE SUBJECT SOFTWARE RESULTS IN ANY LIABILITIES, DEMANDS, DAMAGES,
 * EXPENSES OR LOSSES ARISING FROM SUCH USE, INCLUDING ANY DAMAGES FROM
 * PRODUCTS BASED ON, OR RESULTING FROM, RECIPIENT'S USE OF THE SUBJECT
 * SOFTWARE, RECIPIENT SHALL INDEMNIFY AND HOLD HARMLESS THE UNITED
 * STATES GOVERNMENT, ITS CONTRACTORS AND SUBCONTRACTORS, AS WELL AS ANY
 * PRIOR RECIPIENT, TO THE EXTENT PERMITTED BY LAW.  RECIPIENT'S SOLE
 * REMEDY FOR ANY SUCH MATTER SHALL BE THE IMMEDIATE, UNILATERAL
 * TERMINATION OF THIS AGREEMENT.
 **/
// - the PVS server accepts XML-RPC messages; the only method that can be invoked is pvs.request.
// - the parameter passed to pvs.request is a string encoding of a JSON-RPC message (see
// - https://www.jsonrpc.org/specification) the JSON-RPC message indicates the command to be
// - executed by pvs, e.g., reset, typecheck, etc.

// '{ "result":["change-context", "help", "lisp", "list-client-methods", "list-methods", "names-info",
// 		"proof-command", "prove-formula", "reset", "typecheck" ],
//    "jsonrpc":"2.0", "id":"0" }'

import { Client, Server, createClient, createServer } from 'xmlrpc';
import { PvsProcess } from "./pvsProcess";
import { PvsResponse } from "./common/pvs-gui.d";
import * as fsUtils from './common/fsUtils';
import * as path from 'path';
import * as net from 'net';
import * as crypto from 'crypto';
import { SimpleConnection, StrategyDescriptor, ProofNode,  ProofTree } from './common/serverInterface';
import * as utils from './common/languageUtils';

//----------------------------
// constants introduced for dev purposes, while waiting for the new pvs snapshot
export const show_tccs_result: any =
    [ { id: 'sq_TCC1',
	theory: 'sq',
	comment: [ '% Subtype TCC generated (at line 10, column 23) for  a * a\n    % expected type  nonneg_real' ],
	'from-decl': 'sq',
	definition: 'FORALL (a: real): a * a >= 0',
	proved: true },
      { id: 'sq_div_TCC1',
	theory: 'sq',
	comment: [ '% Subtype TCC generated (at line 32, column 54) for  sq(d)\n    % expected type  nznum' ],
	'from-decl': 'sq_div',
	definition: 'FORALL (d: real): d /= 0 IMPLIES sq(d) /= 0',
  proved: true } ] ;

export const proof_script_result: string =
  ';;; Proof sq_ge-1 for formula sq.sq_ge\n(""\n (skosimp)\n (ground)\n (("1"\n   (expand "sq")\n   (case "forall (x,y:real): x>=y iff not x<y")\n   (("1" (flatten) (assert)) ("2" (skosimp) (ground))))\n  ("2" (assert))))'


const proof_script_check_chev_fup_permission: string = `;;; Proof check_chev_fup_permission-1 for formula alaris_th.check_chev_fup_permission
(""
 (skosimp*)
 (expand "per_release_fup")
 (split)
 (("1" (postpone))
  ("2"
   (expand "fup")
   (expand "decrement")
   (lift-if)
   (split)
   (("1" (postpone)) ("2" (flatten) (postpone))))
  ("3" (expand "per_release_chevron") (flatten) (postpone))))`;  
//----------------------------

var assert = require('assert');

export class PvsProgressInfo {
	protected progressLevel: number = 0;
	showProgress (cmd: string, data?: string): string {
		this.progressLevel++;
		if (this.progressLevel > 4) {
			this.progressLevel = 0;
		}
		return `Executing ${cmd}${".".repeat(this.progressLevel)}`;
	}
}

export declare interface FileList {
  contextFolder: string;
  fileNames: string[]; // TODO: FileDescriptor[]
}

export interface ContextDiagnostics {
  [fileName: string]: PvsResponse
};

type _PvsResponse_ = _PvsError_ | _PvsResult_
interface _PvsError_ {
	jsonrpc: "2.0";
	id: string;
	error: string;
}
interface _PvsResult_ {
	jsonrpc: "2.0";
	id: string;
	result?: string;
}

export class PvsProxy {
	protected debugMode: boolean = false;
	protected isActive: boolean = false;
	readonly MAXTIME: number = 2000; // millis
	readonly MAX_PORT_ATTEMPTS: number = 20;
	readonly client_methods: string[] = ['info', 'warning', 'debug', 'buffer', 'yes-no', 'dialog'];
	protected banner: string;
	protected handlers: { [mth: string]: (params: string[]) => string[] } = {};
	protected serverAddress: string = "0.0.0.0"; // using "0.0.0.0" instead of "localhost" because the client seems to have troubles connecting when indicating "localhost"
	protected serverPort: number;
	protected clientAddress: string = "0.0.0.0";
	protected clientPort: number;
	protected client: Client;
	protected guiServer: Server; // GUI server, needed to receive responses sent back by pvs-server
	protected pvsPath: string;
	protected pvsLibraryPath: string;
	protected pvsServer: PvsProcess;
	protected connection: SimpleConnection; // connection to the client
	protected externalServer: boolean;
	protected cliListener: (data: string) => void; // useful to show progress feedback
	protected progressInfo: PvsProgressInfo; // sends progress feedback to the front-end, in a form that can be rendered in the status bar

	protected parserQueue: Promise<PvsResponse> = Promise.resolve(null);

	/** The constructor simply sets various properties in the PvsProxy class. */
	constructor(pvsPath: string,
		opt?: {
			serverPort?: number,
			clientPort?: number, 
			connection?: SimpleConnection,
			externalServer?: boolean
		}) {
		opt = opt || {};
		this.pvsPath = pvsPath;
		this.pvsLibraryPath = path.join(pvsPath, "lib");
		this.serverPort = (!!opt.serverPort) ? opt.serverPort : 22334;
		this.clientPort = (!!opt.clientPort) ? opt.clientPort : 9092;
		this.client_methods.forEach(mth => {
			this.handlers[mth] = (params: string[]): string[] => {
				// console.info("info", params);
				return params;
			}
		});
		this.banner = `XML-RPC GUI Server active at http://${this.clientAddress}:${this.clientPort}`;
		this.connection = opt.connection;
		this.externalServer = !!opt.externalServer;
		this.cliListener = null;
		this.progressInfo = new PvsProgressInfo();
	}

	//--------------------------------------------------
	//         json-rpc methods
	//--------------------------------------------------
	pvsRequest(method: string, params?: string[]): Promise<PvsResponse> {
		params = params || [];
		const req = { method: method, params: params, jsonrpc: "2.0", id: this.get_fresh_id() };
		return new Promise((resolve, reject) => {
			if (this.client) {
				this.progressInfo.showProgress(method);
				const jsonReq: string = JSON.stringify(req);
				// console.log(jsonReq);
				return this.client.methodCall("pvs.request", [jsonReq, `http://${this.clientAddress}:${this.clientPort}`], async (error: string, value: string) => {
					if (value) {
						this.progressInfo.showProgress(method);
						try {
							const resp: PvsResponse = JSON.parse(value);
							console.dir(resp, { depth: null });
							if (resp && (resp["result"] === "null" || resp["result"] === "nil")) {
								// sometimes pvs returns a string "null" or "nil" as result -- here the string is transformed into a proper null value
								resp["result"] = null;
							}
							resolve(resp);
						} catch (jsonError) {
							console.log(`[pvs-proxy] Unable to parse pvs-server response :/`, value);
							resolve(null);
						}
					} else {
						if (error) {
							console.log(`[pvs-proxy] pvs-server returned error`, error);
						} else {
							console.info(`[pvs-proxy] pvs-server returning null?`);
						}
						await this.rebootPvsServer();
						resolve(null);
					}
				});
			} else {
				console.log(`[pvs-proxy] Warning: could not invoke method ${method} (client is null)`);
				resolve(null);
			}
		});
	}
	async listMethodsRequest(): Promise<PvsResponse> {
		return await this.pvsRequest('list-methods');
	}
	async listClientMethods(): Promise<PvsResponse> {
		return await this.pvsRequest('list-client-methods');
	}

	/**
	 * Parse a given pvs file
	 * @param desc pvs file descriptor: context folder, file name, file extension
	 */
	async parseFile(desc: { contextFolder: string, fileName: string, fileExtension: string,  }): Promise<PvsResponse> {
		if (desc) {
			// using parserQueue to serialize parallel parseFile requests -- pvs-server seems to throw exceptions when sending multiple parse requests at the same time
			// this.parserQueue = new Promise((resolve, reject) => {
			// 	this.parserQueue.then(async () => {
					this.notifyStartExecution(`Parsing ${desc.fileName}`);
					if (this.isProtectedFolder(desc.contextFolder)) {
						this.info(`${desc.contextFolder} is already parsed`);
						// return resolve(null);
						return null;
					}
					const fname: string = path.join(desc.contextFolder, `${desc.fileName}${desc.fileExtension}`);
					const res: PvsResponse = await this.pvsRequest('parse', [fname]);
					//console.info('parseFile:');
					//console.dir(res, { depth: null });
					this.notifyEndExecution();
					if (res && ((res.error && res.error.data) || res.result)) {
						// return resolve(res);
						return res;	
					} else {
						console.log(`[pvs-proxy] Warning: received pvs-server error while parsing file ${desc.fileName}`, res);
						// return resolve(null);
						return null;
					}
			// 	})
			// });
			// return Promise.resolve(this.parserQueue);
		}
		return null;
	}

	/**
	 * Typechecks a given pvs file
	 * @param desc pvs file descriptor: context folder, file name, file extension
	 * @param opt 
	 */
  	async typecheckFile (desc: { contextFolder: string, fileName: string, fileExtension: string,  }): Promise<PvsResponse> {
		if (desc) {
			this.notifyStartImportantTask(`Typechecking file ${desc.fileName}${desc.fileExtension}`);
			if (this.isProtectedFolder(desc.contextFolder)) {
				this.info(`${desc.fileName}${desc.fileExtension} is already typechecked`);
				return null;
			}
			const fname: string = path.join(desc.contextFolder, `${desc.fileName}${desc.fileExtension}`);
			const res: PvsResponse = await this.pvsRequest('typecheck', [ fname ]);
			if (res && (res.error && res.error.data) || res.result) {
				if (res.result) {
					this.notifyEndImportantTask(`Typechecking successful for ${desc.fileName}${desc.fileExtension}`);
				} else {
					this.reportError(`Typecheck error in file ${desc.fileName}${desc.fileExtension}: ${res.error.data.error_string}`);
				}
			} else {
				console.log(`[pvs-proxy] Warning: received pvs-server error while typechecking file ${desc.fileName}${desc.fileExtension}`, res);
			}
			return res;
		}
		return null;
	}

	/**
	 * Re-runs the proofs for all theorems and tccs in the given pvs file
	 * @param desc 
	 */
	async proveFile (desc: { contextFolder: string, fileName: string, fileExtension: string,  }): Promise<PvsResponse> {
		if (desc) {
			this.notifyStartExecution(`Proving ${desc.fileName}`);
			if (this.isProtectedFolder(desc.contextFolder)) {
				this.info(`${desc.contextFolder} is already proved`);
				return null;
			}
			const fname: string = path.join(desc.contextFolder, `${desc.fileName}${desc.fileExtension}`);
			const res: PvsResponse = await this.pvsRequest('prove-pvs-file', [ fname ]);
			this.notifyEndExecution();
			return res;
		}
		return null;
	}

	/**
	 * Starts an interactive prover session for the given formula
	 * @param desc 
	 */
	async proveFormula(desc: { contextFolder: string, fileName: string, fileExtension: string, theoryName: string, formulaName: string }): Promise<PvsResponse> {
		if (desc) {
			this.notifyStartExecution(`Proving formula ${desc.formulaName}`);
			await this.changeContext(desc.contextFolder);
			const ans: PvsResponse = await this.pvsRequest("prove-formula", [ desc.formulaName, desc.theoryName ]);			
			this.notifyEndExecution();
			return ans;
		}
		return null;
	}


	/**
	 * THIS IS NOT SUPPORTED YET
	 * Starts an interactive pvsio evaluator session for the given theory
	 * @param desc 
	 */
	// async pvsioEvaluator (desc: { contextFolder: string, fileName: string, fileExtension: string, theoryName: string }): Promise<PvsResponse> {
	// 	if (desc) {
	// 		this.notifyStartExecution(`Evaluation environment for ${desc.theoryName}`);
	// 		if (this.isProtectedFolder(desc.contextFolder)) {
	// 			this.info(`${desc.contextFolder} cannot be evaluated`);
	// 			return null;
	// 		}
	// 		const fname: string = path.join(desc.contextFolder, `${desc.fileName}${desc.fileExtension}`);
	// 		const res: PvsResponse = await this.lisp(`(pvsio "${fname}" t)`);
	// 		this.notifyEndExecution();
	// 		return res;
	// 	}
	// 	return null;
	// }

	/**
	 * Returns the status of all proofs in a given theory
	 * @param desc Descriptor specifying context folder and theory name
	 */
	async statusProofTheory (desc: { contextFolder: string, fileName: string, fileExtension: string, theoryName: string }): Promise<PvsResponse> {
		if (desc) {
			await this.changeContext(desc.contextFolder);
			const res: PvsResponse = await this.pvsRequest('lisp', [ `(status-proof-theory "${desc.theoryName}")` ]);
			return res;
		}
		return null;
	}

	/**
	 * Changes context
	 * @param contextFolder 
	 */
	async changeContext (desc: string | { contextFolder: string }): Promise<PvsResponse> {
		if (desc) {
			const ctx: string = (typeof desc === "string") ? desc : desc.contextFolder;
			return await this.pvsRequest('change-context', [ ctx ]);
		}
		return null;
	}

	/**
	 * Returns the current context
	 */
	async currentContext (): Promise<PvsResponse> {
		return await this.pvsRequest('lisp', [ '(pvs-current-directory)' ]);
	}

	/**
	 * Executes a lisp command in pvs
	 * @param cmd 
	 */
	async lisp(cmd: string): Promise<PvsResponse> {
		return await this.pvsRequest('lisp', [ cmd ]);
	}

	/**
	 * Finds a symbol declaration
	 * @param symbolName Symbol name 
	 */
	async findDeclaration(symbolName: string): Promise<PvsResponse> {
		return await this.pvsRequest('find-declaration', [ symbolName ]);
	}

	/**
	 * Executes a proof command
	 * @param desc Descriptor of the proof command
	 */
	async proofCommand(desc: { cmd: string }): Promise<PvsResponse> {
		if (desc) {
			this.notifyStartExecution(`Executing ${desc.cmd}`);
			// console.dir(desc, { depth: null });
			const res: PvsResponse =  await this.pvsRequest('proof-command', [ desc.cmd ]);
			// --- to invoke more commands, just do as follows (no need to use then, just use await)
			// const stat: PvsResponse = await this.pvsRequest('prover-status', []);
			// console.dir(stat);
			this.notifyEndExecution();
			return res;
		}
		return null;
	}

	/**
	 * Returns the prover status
	 */
	async proverStatus(): Promise<PvsResponse> {
		const res: PvsResponse = await this.pvsRequest('prover-status');
		return res;
	}

	/**
	 * Returns the proof script for the given formula
	 */
	async proofScript(desc: { contextFolder: string, fileName: string, fileExtension: string, formulaName: string, theoryName: string }): Promise<PvsResponse> {
		if (desc) {
			// const fname: string = fsUtils.desc2fname(desc);
			// const result: PvsResponse = await this.pvsRequest('proof-script', [ fname, desc.formulaName ]);
			// return result;
			return { 
				result: proof_script_check_chev_fup_permission, //proof_script_result, 
				jsonrpc: "2.0", 
				id: "testing-proof-script" 
			};
		}
		return null;
	}

	/**
	 * Shows all tccs generated for the given theory
	 * @param desc 
	 */
	async showTccs(desc: { contextFolder: string, fileName: string, fileExtension: string, theoryName: string }): Promise<PvsResponse> {
		if (desc) {
			this.notifyStartExecution(`Generating proof obligations for theory ${desc.theoryName}`);
			// @SAM: this is the API I want it
			// const fname: string = fsUtils.desc2fname(desc);
			// const res: PvsResponse = await this.pvsRequest('show-tccs', [ fname, desc.theoryName ]);

			// this is how it works now
			await this.changeContext(desc.contextFolder);
			const res: PvsResponse = await this.pvsRequest('show-tccs', [ desc.theoryName ]);
			this.notifyEndExecution();
			return res;
			// return { result: show_tccs_result, jsonrpc: "2.0", id: "testing-show-tccs-result" };
			// return null;
		}
		return null;
	}

	/**
	 * Discharge all tccs generated for the given theory
	 * @param desc 
	 */
	async proveTccs(desc: { contextFolder: string, fileName: string, fileExtension: string }): Promise<PvsResponse> {
		if (desc) {
			const fname: string = path.join(desc.contextFolder, `${desc.fileName}${desc.fileExtension}`);
			const res: PvsResponse = await this.pvsRequest('prove-tccs', [ fname ]);
			return res;
		}
		return null;
	}

	/**
	 * Parse all files in the given context folder
	 */
	// async parseContextParallel(contextFolder: string): Promise<ContextDiagnostics> {
	// 	let result: ContextDiagnostics = {};
	// 	// console.info(`[xmlrpc-proxy] Parsing context ${contextFolder}`);
	// 	if (!this.isProtectedFolder(contextFolder)) {
	// 		const contextFiles: FileList = await fsUtils.listPvsFiles(contextFolder);
	// 		const promises: Promise<void>[] = [];
	// 		if (contextFiles && contextFiles.fileNames) {
	// 		for (const i in contextFiles.fileNames) {
	// 			promises.push(new Promise(async (resolve, reject) => {
	// 				const fname: string = contextFiles.fileNames[i];
	// 				const fileName: string = fsUtils.getFileName(fname);
	// 				const fileExtension: string = fsUtils.getFileExtension(fname);
	// 				const ans: PvsResponse = await this.parseFile({ fileName, fileExtension, contextFolder });
	// 				// console.info('parseContextParallel: ans = ');
	// 				console.dir(ans, { depth: null });
	// 				// if there is a parser error, check that the fileName is provided
	// 				result[fname] = ans;
	// 				resolve();
	// 			}));
	// 		}
	// 		try {
	// 			await Promise.all(promises);
	// 		} catch (error) {
	// 			console.error(`[pvs-proxy] Error while parsing context ${contextFolder}`);
	// 			return null;
	// 		}
	// 		}
	// 	}
	// 	// console.info(`[pvs-proxy] ${contextFolder} parsed!`);
	// 	return null;
	// }

	/**
	 * Parse all files in the given context folder
	 */
	async parseContext (contextFolder: string): Promise<ContextDiagnostics> {
		this.notifyStartExecution(`Parsing folder ${contextFolder}`);
		let result: ContextDiagnostics = {};
		// console.info(`[pvs-proxy] Parsing folder ${contextFolder}`);
		if (!this.isProtectedFolder(contextFolder)) {
			result = {};
			const contextFiles: FileList = await fsUtils.listPvsFiles(contextFolder);
			if (contextFiles && contextFiles.fileNames) {
				for (const i in contextFiles.fileNames) {
					const fname: string = contextFiles.fileNames[i];
					const fileName: string = fsUtils.getFileName(fname);
					const fileExtension: string = fsUtils.getFileExtension(fname);
					const ans: PvsResponse = await this.parseFile({ fileName, fileExtension, contextFolder });
					result[fname] = ans;
				}
			}
		}
		this.notifyEndExecution();
		// console.info(`[pvs-proxy] ${contextFolder} parsed!`);
		return result;
	}

	/**
	 * Returns pvs version information
	 */
	async getPvsVersionInfo(): Promise<{ "pvs-version": string, "lisp-version": string }> {
		const res: PvsResponse = await this.lisp(`(get-pvs-version-information)`);
		if (res && res.result) {
			const regexp: RegExp = /\((\d+.?\d*)[\s|nil]*([\w\s\d\.]*)/g; // group 1 is pvs version, group 2 is lisp version
			const info: RegExpMatchArray = regexp.exec(res.result);
			if (info && info.length > 2) {
				return {
					"pvs-version": info[1],
					"lisp-version": info[2]
				}
			}
		}
		return null;
	}

	
	//--------------------------------------------------
	//         internal functions
	//--------------------------------------------------
	protected info (...data: any): void {
		if (this.debugMode) {
			console.info(data);
		}
		if (this.cliListener) {
			this.cliListener(data);
		}
	}
	protected notifyStartExecution (msg: string): void {
		if (this.connection) {
			this.connection.sendNotification("server.status.progress", msg);
		}
	}
	protected notifyEndExecution (): void {
		if (this.connection) {
			this.connection.sendNotification("server.status.ready");
		}
	}
	protected notifyStartImportantTask (msg: string): void {
		if (this.connection) {
			this.connection.sendNotification("server.status.start-important-task", msg);
		}
	}
	protected notifyEndImportantTask (msg: string): void {
		if (this.connection) {
			this.connection.sendNotification("server.status.end-important-task", msg);
		}
	}
	protected reportError (msg: string): void {
		// error shown in a dialogue box
		if (this.connection) {
			this.connection.sendNotification("server.status.report-error", msg);
		}
	}
	protected notifyError (msg: string): void {
		// error shown in the status bar
		if (this.connection) {
			this.connection.sendNotification("server.status.error", msg);
		}
	}
	/**
	 * Checks availability of the port. Returns true if the port is available, false otherwise.
	 * The check works as follows. A dummy server is created at port p; if the creation of the server succeeds, an event 'listening' is triggered, otherwise an event 'error' is triggered.
	 * The server is turned off as soon as an answer is available.
	 */
	protected async portIsAvailable(p: number): Promise<boolean> {
		// console.info(`checking port ${p}`);
		return new Promise((resolve, reject) => {
			const server: net.Server = net.createServer();
			server.once('error', (error: Error) => {
				console.log(`port ${p} is not available :/`);
				resolve(false);
			});
			server.once('listening', () => {
				// console.error(`port ${p} is available :)`);
				server.close();
				resolve(true);
			});
			server.listen(p);
		});
	}

	/**
	 * Checks if pvs-server accepts connection
	 */
	async testServerConnectivity(): Promise<boolean> {
		const client: Client = createClient({
			host: "0.0.0.0", port: this.clientPort, path: "/RPC2"
		});
		return new Promise((resolve, reject) => {
			client.methodCall('request', [], (error, value) => {
				if (error) {
					console.log("server-test error:", error);
					return resolve(false);
				}
				// console.log("server-test value:", value);
				return resolve(true);
			});
		});
	}

	/**
	 * Callback function called from activate, when gui-server is ready 
	 */
	protected serverReadyCallBack() {
		this.guiServer.on('request', (error: any, params: string[], callback: (error: any, value: any) => void) => {
			if (error) {
				console.log(error);
			}
			// console.log("params", params);
			if (params && params.length > 0) {
				try {
					for (let i = 0; i < params.length; i++) {
						const json: { method: string, params: string[] } = JSON.parse(params[i]);
						// console.info(`\n json: `, json);
						if (json && json.method && this.handlers[json.method]) {
							this.handlers[json.method](json.params);
						}
					}
				} catch (jsonError) {
					console.log(jsonError);
				}
			}
			callback(error, params);
		});
		this.guiServer.on("error", (error: Error) => {
			console.log(`[pvs-proxy] GUI-Server Error`, error);
		});
		this.guiServer.on("connect", (error: any, params: string, callback: (error: any, value: any) => void) => {
			if (error) {
				console.log("[pvs-proxy] connection error", error);
			}
			if (params) {
				console.info("[pvs-proxy] connection params", params);
			}
		});
		this.isActive = true;
		// console.info(this.server.httpServer);
	}
	/**
	 * Utility function, creates a new pvs-server
	 */
	protected async createPvsServer(opt?: { enableNotifications?: boolean }): Promise<PvsProcess | null> {
		opt = opt || {};
		const connection: SimpleConnection = (opt.enableNotifications) ? this.connection : null;
		const proc: PvsProcess = new PvsProcess({ pvsPath: this.pvsPath, contextFolder: this.pvsPath }, connection);
		const success: boolean = await proc.activate({
			enableNotifications: opt.enableNotifications,
			xmlRpcServer: { port: this.serverPort }
		});
		if (success) {
			if (connection) {
				connection.console.info(`[pvs-proxy] pvs-server active at http://${this.serverAddress}:${this.serverPort}`);
			} else {
				console.info(`[pvs-proxy] pvs-server active at http://${this.serverAddress}:${this.serverPort}`);
			}
			return proc;
		}
		console.log(`[pvs-proxy] Failed to activate pvs-server at http://${this.serverAddress}:${this.serverPort}`);
		this.notifyError("Failed to start pvs-server");
		return null;
	}
	/**
	 * Kill pvs process
	 */
	async killPvsServer(): Promise<void> {
		if (this.pvsServer) {
			await this.pvsServer.kill();
		}
	}
	/**
	 * Kill pvs-gui server
	 */
	async killPvsProxy (): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.guiServer) {
				this.guiServer.httpServer.close(() => {
					delete this.guiServer;
					delete this.client;
					this.isActive = false;
					resolve();
				});
			} else {
				this.isActive = false;
				resolve();
			}
		});
	}
	async restartPvsServer (): Promise<void> {
		console.info("[pvs-proxy] Rebooting pvs-server");
		await this.killPvsServer();
		await this.createPvsServer();
		console.info("[pvs-proxy] Reboot completed!");
	}

	async listSystemMethods (): Promise<{ error: { code: string, message: string, stack: string }, result: string[] }> {
		return new Promise((resolve, reject) => {
			if (this.client) {
				this.client.methodCall("system.listMethods", [ ], (error: { code: string, message: string, stack: string }, value: string[]) => {
					resolve({ error, result: value });
				});
			} else {
				console.log('[pvs-proxy] Warning: client is null :/');
				resolve(null);
			}
		});
	}

	async rebootPvsServer (): Promise<boolean> {
		if (!this.externalServer) {
			console.info("[pvs-proxy] Restarting pvs-server...");
			this.pvsServer = await this.createPvsServer({ enableNotifications: true });
			return true;
		}
		return false;
	}

  // async xmlrpcMethodHelp (methodName: string): Promise<XmlRpcResponse> {
  // 	return new Promise((resolve, reject) => {
  // 	    this.client.methodCall("system.methodHelp", [ methodName ], (error: XmlRpcError, value: string) => {
  // 		const res: RpcPvsResponse = JSON.parse(value);
  // 		resolve({ error, res });
  // 	    });
  // 	});
  // }

	/**
	 * Utility methods
	*/
	get_fresh_id(): string {
		// getTime can be used, but does potentially lead to duplicate ids
		// return new Date().getTime();
		// This may be overkill, a simple call to random is probably good enough.
		return crypto.createHash('sha256').update(Math.random().toString(36)).digest('hex');
	}
	isProtectedFolder(contextFolder: string): boolean {
		return !(contextFolder !== this.pvsPath && contextFolder !== this.pvsLibraryPath);
	}

	/**
	 * Other internal methods
	 */
	protected async disableGcPrintout (): Promise <PvsResponse> {
		return await this.pvsRequest('lisp', [ '(setq *disable-gc-printout* t)' ]);
	}
	protected async namesInfo(fileName: string): Promise<PvsResponse> {
		return await this.pvsRequest('names-info', [ fileName ]);
	}
	protected async xmlrcpReset(): Promise<PvsResponse> {
		return await this.pvsRequest('reset');
	}



	/**
	 * pvs-proxy activation function
	 * @param opt 
	 */
	async activate(opt?: { debugMode?: boolean, showBanner?: boolean }): Promise<boolean> {
		opt = opt || {};
		opt.showBanner = (opt.showBanner === undefined) ? true : opt.showBanner;
		this.debugMode = !!opt.debugMode;
		if (this.isActive) {
			return Promise.resolve(true);
		}
		// create pvs server
		this.notifyStartExecution("Activating pvs language features...");
		if (!this.externalServer) {
			this.pvsServer = await this.createPvsServer({ enableNotifications: true });
		}
		if (this.externalServer || this.pvsServer) {
			// activate proxy
			return new Promise(async (resolve, reject) => {
				this.notifyStartExecution(`Loading user interface components...`);
				try {
					let portIsAvailable: boolean = false;
					for (let i = 0; !portIsAvailable && i < this.MAX_PORT_ATTEMPTS; i++) {
						portIsAvailable = await this.portIsAvailable(this.clientPort);
						if (portIsAvailable === false) {
							this.clientPort++;
						}
					}
					if (portIsAvailable) {
						this.client = createClient({
							host: this.serverAddress, port: this.serverPort, path: "/RPC2"
						});
						if (!this.client) {
							console.log(`[pvs-proxy] Error: could not create client necessary to connect to pvs-server`);
							reject(false);
						}
						this.guiServer = createServer({
							host: this.clientAddress, port: this.clientPort, path: "/RPC2"
						}, () => {
							this.serverReadyCallBack();
							if (opt.showBanner) {
								console.log(this.banner);
							}
							this.notifyEndExecution();
							resolve(true);
						});
					} else {
						console.log(`[pvs-proxy] Error: could not start GUI-server`);
						reject(false);
					}
				} catch (err) {
					console.log("[pvs-proxy] Error while activating XmlRpcProvider", JSON.stringify(err));
					reject(false);
				}
			});
		} else {
			console.log(`[pvs-proxy] Failed to create Pvs Process :/`);
			return false;
		}
	}

}