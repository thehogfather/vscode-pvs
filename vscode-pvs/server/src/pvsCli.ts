/**
 * @module PvsCli
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

import * as utils from './common/languageUtils';
import * as readline from 'readline';
import { PvsCliInterface, SimpleConsole, StrategyDescriptor, SimpleConnection, serverEvent, serverCommand } from './common/serverInterface';
import * as fsUtils from './common/fsUtils';

import { cliSessionType } from './common/serverInterface';
import { PvsProxy } from './pvsProxy';
import { PvsResponse } from './common/pvs-gui';

import * as WebSocket from 'ws';

const usage: string = `
${utils.colorText("PVS Prover Command Line Interface (PVS-CLI)", utils.textColor.blue)}
Usage: node pvsCli '{ "pvsPath": "<path-to-pvs-installation>", "contextFolder": "<context-folder>" }'
`;

class CliConsole implements SimpleConsole {
	protected connection: CliConnection = null;

	constructor (connection?: CliConnection) {
		this.connection = connection;
	}
	log (elem: any) {
		if (this.connection) {
			this.connection.console.log(elem);
		} else {
			console.log(elem);
		}
	}
	error (elem: any) {
		if (this.connection) {
			this.connection.console.error(elem);
		} else {
			console.error(elem);
		}
	}
	info (str: string) {
		if (this.connection) {
			this.connection.console.info(str);
		} else {
			console.info(str);
		}
	}
	warn (str: string) {
		if (this.connection) {
			this.connection.console.warn(str);
		} else {
			console.warn(str);
		}
	}
}

class CliConnection implements SimpleConnection {
	public console: CliConsole;
	constructor () {
		this.console = new CliConsole();
	}
	sendNotification (type: string, msg?: string): void { };
	sendRequest (type: string, data: any): void { };
}


// utility function, ensures open brackets match closed brackets for commands
function parMatch (cmd: string): string {
	const openRegex: RegExp = new RegExp(/\(/g);
	const closeRegex: RegExp = new RegExp(/\)/g);
	let par: number = 0;
	while (openRegex.exec(cmd)) {
		par++;
	}
	while (closeRegex.exec(cmd)) {
		par--;
	}
	if (par > 0) {
		// missing closed brackets
		cmd = cmd.trimRight() + ')'.repeat(par);
		// console.log(`Mismatching parentheses automatically fixed: ${par} open round brackets without corresponding closed bracket.`)
	} else if (par < 0) {
		cmd = '('.repeat(-par) + cmd;
		// console.log(`Mismatching parentheses automatically fixed: ${-par} closed brackets did not match any other open bracket.`)
	}
	return cmd.startsWith('(') ? cmd : `(${cmd})`; // add outer parentheses if they are missing
}

// utility function, ensures open brackets match closed brackets for commands
function quotesMatch (cmd: string): boolean {
	const quotesRegex: RegExp = new RegExp(/\"/g);
	let nQuotes: number = 0;
	while (quotesRegex.exec(cmd)) {
		nQuotes++;
	}
	return nQuotes % 2 === 0;
}

function isQED (cmd: string): boolean {
	return cmd.startsWith("Q.E.D.");
}

let progressLevel: number = 0;
let progressMsg: string = "";
function showProgress (data: string) {
	progressLevel++;
	if (progressLevel > 4) {
		progressLevel = 0;
		readline.clearLine(process.stdin, 0);
	}
	console.log("  " + progressMsg + ".".repeat(progressLevel));
	readline.moveCursor(process.stdin, 0, -1);
}


class PvsCli {
	protected rl: readline.ReadLine;
	// protected pvsProcess: PvsProcess;

	protected static proverStrategies: string[] = utils.PROVER_STRATEGIES_CORE.map((strat: StrategyDescriptor) => {
		return strat.name;
	});
	protected static evaluatorFunctions: string[] = utils.EVALUATOR_FUNCTIONS_CORE.map((strat: StrategyDescriptor) => {
		return strat.name;
	});

	// protected pvsPath: string;
	protected contextFolder: string;
	protected pvsProxy: PvsProxy;
	protected fileName: string;
	protected fileExtension: string;
	protected theoryName: string;
	protected formulaName: string;
	protected line: number;

	protected clientID: string;

	protected connection: CliConnection;

	protected cmds: string[] = []; // queue of commands to be executed
	protected tabCompleteMode: boolean = false;

	protected args: PvsCliInterface;

	protected proofState: string;

	protected wsClient: WebSocket;

	protected proverPrompt: string = " >> ";
	protected evaluatorPrompt: string = "<PVSio> ";

	/**
	 * @constructor
	 * @param args information necessary to launch the theorem prover
	 */
	constructor (args?: PvsCliInterface) {
		this.args = args;
		this.clientID = fsUtils.get_fresh_id();
	}
	activateEvaluatorRepl () {
		if (process.stdin.isTTY) {
			// this is necessary for correct handling of navigation keys and tab-autocomplete in the prover prompt
			process.stdin.setRawMode(true);
		}
		readline.emitKeypressEvents(process.stdin);
		this.rl = readline.createInterface(process.stdout, process.stdin, (line: string) => { return this.evaluatorCompleter(line); });
		this.rl.setPrompt(utils.colorText(this.evaluatorPrompt, utils.textColor.blue));
		this.rl.on("line", async (cmd: string) => {
			if (utils.isQuitCommand(cmd)) {
				this.wsClient.send(JSON.stringify({
					type: serverCommand.evaluateExpression,
					cmd: "quit",
					fileName: this.args.fileName,
					fileExtension: this.args.fileExtension,
					contextFolder: this.args.contextFolder,
					theoryName: this.args.theoryName,
					formulaName: this.args.formulaName
				}));	
				console.log();
				console.log("PVSio evaluator session terminated.");
				console.log();
				console.log();
				this.rl.question("Press Enter to close the terminal.", () => {
					this.wsClient.send(JSON.stringify({ type: "unsubscribe", channelID: this.args.channelID, clientID: this.clientID }));
					this.wsClient.close();
				});
			} else {
				cmd = (cmd.endsWith(";") || cmd.endsWith("!")) ? cmd : `${cmd};`;
				this.wsClient.send(JSON.stringify({
					type: serverCommand.evaluateExpression,
					cmd,
					fileName: this.args.fileName,
					fileExtension: this.args.fileExtension,
					contextFolder: this.args.contextFolder,
					theoryName: this.args.theoryName,
					formulaName: this.args.formulaName
				}));
			}
		});		
		this.connection = new CliConnection();
	}
	activateProverRepl () {
		if (process.stdin.isTTY) {
			// this is necessary for correct handling of navigation keys and tab-autocomplete in the prover prompt
			process.stdin.setRawMode(true);
		}
		readline.emitKeypressEvents(process.stdin);
		this.rl = readline.createInterface(process.stdout, process.stdin, (line: string) => { return this.proverCompleter(line); });
		this.rl.setPrompt(utils.colorText(this.proverPrompt, utils.textColor.blue));
		this.rl.on("line", async (cmd: string) => {
			if (utils.isSaveCommand(cmd)) {
				console.log();
				console.log("Proof saved successfully!");
				console.log();
				this.wsClient.send(JSON.stringify({
					type: serverCommand.proofCommand,
					cmd: "save",
					fileName: this.args.fileName,
					fileExtension: this.args.fileExtension,
					contextFolder: this.args.contextFolder,
					theoryName: this.args.theoryName,
					formulaName: this.args.formulaName
				}));
				// show prompt
				this.rl.prompt();
			} else if (utils.isQuitCommand(cmd)) {
				console.log();
				console.log("Prover session terminated.");
				console.log();
				this.wsClient.send(JSON.stringify({
					type: serverCommand.proofCommand,
					cmd: "quit",
					fileName: this.args.fileName,
					fileExtension: this.args.fileExtension,
					contextFolder: this.args.contextFolder,
					theoryName: this.args.theoryName,
					formulaName: this.args.formulaName
				}));	
				this.rl.question("Press Enter to close the terminal.", () => {
					this.wsClient.send(JSON.stringify({ type: "unsubscribe", channelID: this.args.channelID, clientID: this.clientID }));
					this.wsClient.close();	
				});
			} else if (isQED(cmd)) {
				readline.moveCursor(process.stdin, 0, -1);
				readline.clearScreenDown(process.stdin);
				console.log();
				console.log(utils.colorText("Q.E.D.", utils.textColor.green));
				console.log();
				this.rl.question("Press Enter to close the terminal.", () => {
					this.wsClient.send(JSON.stringify({ type: "unsubscribe", channelID: this.args.channelID, clientID: this.clientID }));
					this.wsClient.close();	
				});
			} else {
				if (quotesMatch(cmd)) {
					cmd = parMatch(cmd);
					// log command, for debugging purposes
					// this.connection.console.log(utils.colorText(cmd, utils.textColor.blue)); // re-introduce the command with colors and parentheses
				} else {
					this.connection.console.warn("Mismatching double quotes, please check your expression");
				}
				this.wsClient.send(JSON.stringify({
					type: serverCommand.proofCommand, 
					cmd,
					fileName: this.args.fileName,
					fileExtension: this.args.fileExtension,
					contextFolder: this.args.contextFolder,
					theoryName: this.args.theoryName,
					formulaName: this.args.formulaName
				}));
			}
		});		
		this.connection = new CliConnection();
	}
	async subscribe (channelID: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
			this.wsClient = new WebSocket("ws://0.0.0.0:33445");
			this.wsClient.on("open", () => {
				// subscribe to cli gateway
				// const channelID: string = utils.desc2id({ fileName: this.args.fileName, theoryName: this.args.theoryName, formulaName: this.args.formulaName });
				// console.log(`Subscribing to ${terminalID}`);
                this.wsClient.send(JSON.stringify({ type: "subscribe", channelID, clientID: this.clientID }));
			});
			this.wsClient.on("message", (msg: string) => {
				// console.log(msg);
				try {
					const data = JSON.parse(msg);
					if (data) {
						switch (data.type) {
							case "subscribe-response": {
								// this.wsClient.send(JSON.stringify({ type: "publish", channelID: "event.cli-ready", clientID: this.clientID }));
								// console.log(`Client ${this.clientID} ready to receive events ${channelID}`);
								resolve(data.success);
								break;
							}
							case serverEvent.evaluatorStateUpdate: {
								const pvsResponse: PvsResponse = data.response;
								if (pvsResponse) {
									if (pvsResponse.result) {
										console.log(utils.formatPvsIoState(pvsResponse.result, { useColors: true }));
									} else if (pvsResponse.banner) {
										console.log(pvsResponse.banner);
									}
								}
								// remove the standard prompt created by PVSio
								readline.moveCursor(process.stdin, 0, -1);
								readline.clearScreenDown(process.stdin);
								// show prompt
								this.rl.prompt();
								readline.clearLine(process.stdin, 1); // clear any previous input
								break;
							}
							case serverEvent.proofStateUpdate: {
								const pvsResponse: PvsResponse = data.response;
								if (pvsResponse) {
									if (pvsResponse.result) {
										const res: utils.ProofState = pvsResponse.result;
										// print commentary in the CLI
										if (res.commentary && typeof res.commentary === "object" && res.commentary.length > 0) {
											// the last line of the commentary is the sequent, dont' print it!
											for (let i = 0; i < res.commentary.length - 1; i++) {
												console.log(res.commentary[i]);
											}
										}
										this.proofState = utils.formatProofState(res);
										console.log(utils.formatProofState(pvsResponse.result, { useColors: true, showAction: true })); // show proof state										
										this.rl.prompt(); // show prompt
										readline.clearLine(process.stdin, 1); // clear any previous input
									} else {
										console.warn(`[pvs-cli] Warning: received null result from pvs-server`);
									}
								} else {
									console.warn(`[pvs-cli] Warning: received null response from pvs-server`);
								}
								break;
							}
							// case serverEvent.typecheckFileResponse: {
							// 	const pvsResponse: PvsResponse = data.response;
							// 	if (pvsResponse.error) {
							// 		console.log(`${utils.colorText("Typecheck error", utils.textColor.red)}`);
							// 		console.dir(data.response, { colors: true, depth: null });
							// 	} else {
							// 		console.log(`[pvs-cli] Typechecking completed successfully!`);
							// 	}
							// 	this.rl.question("Press Enter to close the terminal", () => {
							// 		this.wsClient.send(JSON.stringify({ type: "unsubscribe", channelID, clientID: this.clientID }));
							// 		this.wsClient.close();	
							// 	});
							// 	break;
							// }
							default: {
								console.error("[pvs-cli] Warning: received unknown message type", data);
							}
						}
					} else {
						console.error("[pvs-cli] Warning: received empty message");
					}
				} catch (jsonError) {
					// FIXME: investigate why sometimes we get malformed json
					// console.error("[pvs-cli] Error: received malformed json string", msg);
				}
            });
            this.wsClient.on("error", (err: Error) => {
                console.error(err);
                resolve(false);
            });
		});
    }

	protected proverCompleter (line: string) {
		let hits: string[] = [];
		// console.log(`[pvs-cli] trying to auto-complete ${line}`);
		if (line.startsWith("(expand") || line.startsWith("expand")) {
			// autocomplete symbol names
			const symbols: string[] = utils.listSymbols(this.proofState);
			// console.dir(symbols, { depth: null });
			if (symbols && symbols.length) {
				for (let i = 0; i < symbols.length; i++) {
					if (`(expand "${symbols[i]}"`.startsWith(line)) {
						hits.push(`(expand "${symbols[i]}"`);
					} else if (`expand "${symbols[i]}"`.startsWith(line)) {
						hits.push(`expand "${symbols[i]}"`);
					}
				}
			}
		} else if (line.trim().startsWith("(")) {
			hits = PvsCli.proverStrategies.map((c: string) => {
				// console.log(`(${c}`);
				return `(${c}`;
			}).filter((c: string) => c.startsWith(line));
		} else {
			// Show all completions if none found
			// return [ hits.length ? hits : PvsCli.completions, line ];
			// show nothing if no completion is found
			hits = PvsCli.proverStrategies.filter((c: string) => c.startsWith(line));
		}
		return [ hits, line ];
	}
	protected evaluatorCompleter (line: string) {
		let hits: string[] = [];
		// autocomplete symbol names
		// const symbols: string[] = utils.listSymbols(...);
		// console.dir(symbols, { depth: null });
		// if (symbols && symbols.length) {
		// 	hits = symbols.filter((c: string) => c.startsWith(line));
		// }
		// Include also pvsio functions in the list
		hits = hits.concat(PvsCli.evaluatorFunctions.filter((c: string) => c.startsWith(line)));
		return [ hits, line ];
	}
	protected notifyStartExecution (msg: string): void {
		if (this.connection) {
			this.connection.console.info(msg);
		}
	}
	protected notifyEndExecution (): void {
		if (this.connection) {
			this.connection.console.info("Ready!");
		}
	}
	protected qed (ans: PvsResponse): boolean {
		return ans && ans.result && ans.result.result && ans.result.result === "Q.E.D.";
	}
}


if (process.argv.length > 2) {
	// ATTN: the client must not print anything on the console until it's subscribed --- vscodePvsPvsCli checks the output on the console to understand when the client is ready.
	const args: PvsCliInterface = JSON.parse(process.argv[2]);
	readline.cursorTo(process.stdout, 0, 0);
	readline.clearScreenDown(process.stdout);
	const pvsCli: PvsCli = new PvsCli(args);
	pvsCli.subscribe(args.channelID).then((success: boolean) => {
		console.log(args);
		if (success) {
			switch (args.type) {
				case cliSessionType.proveFormula: {
					console.log(`\nStarting new prover session for ${utils.colorText(args.formulaName, utils.textColor.blue)}\n`);
					pvsCli.activateProverRepl();
					break;
				}
				case cliSessionType.pvsioEvaluator: {
					console.log(`\nStarting new PVSio evaluator session for theory ${utils.colorText(args.theoryName, utils.textColor.blue)}\n`);
					pvsCli.activateEvaluatorRepl();
					break;
				}
				default: {
					console.error("[pvsCli] Warning: unknown cli session type", args);
				}
			}
		} else {
			console.error("[pvs-cli] Error: unable to register client", args);
		}
	});
} else {
	console.log(usage);
}

