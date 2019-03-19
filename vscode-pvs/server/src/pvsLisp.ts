/**
 * @module PvsLisp
 * @version 2019.03.14
 * PvsLisp, transform pvs lisp output into JSON objects. 
 * @author Paolo Masci
 * @date 2019.03.14
 * @copyright 
 * Copyright 2016 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration. No
 * copyright is claimed in the United States under Title 17, 
 * U.S. Code. All Other Rights Reserved.
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

import { spawn, ChildProcess } from 'child_process';
import { PvsExecutionContext } from './common/pvsExecutionContextInterface';
import * as language from "./common/languageKeywords";
import { 
	PvsResponseType, PvsParserResponse, getFilename, PvsDeclarationDescriptor, getPathname,
	PRELUDE_FILE, PvsDeclarationType, FormulaDescriptor, ProofResult, PrettyPrintRegionRequest,
	PrettyPrintRegionResult, ExpressionDescriptor, EvaluationResult, PvsListDeclarationsRequest,
	PvsFindDeclarationRequest, PvsFindDeclarationResponse, PvsTheoryListDescriptor,
	TccDescriptorArray, TccDescriptor, PvsFileListDescriptor, PvsTypecheckerResponse
} from './common/serverInterface'
import { Connection, TextDocument } from 'vscode-languageserver';
import * as path from 'path';
import { PVS_TRUE_FALSE_REGEXP_SOURCE, PVS_STRING_REGEXP_SOURCE } from "./common/languageKeywords";
import * as fs from './common/fsUtils';

interface ParseExpressionDescriptor {
	kind: string
};
interface PvsShowDeclarationInterface {
	theoryName: string,
	declaration: string,
	comment: string
}
export interface PvsFindDeclarationInterface {
    [ key: string ] : PvsDeclarationType;
}
export interface PvsShowImportChain {
	theories: string[] // list of theories, ordered by import
}

// utility functions and constants
const PVS_LISP_ERROR_RETURN_TO_TOP_LEVEL: string = 'Return to Top Level (an "abort" restart)';
function getKey(theoryName: string, symbolName: string): string {
	return theoryName + "." + symbolName;
}

export interface Console {
    console: { 
        log: (str: string) => void,
        error: (str: string) => void,
        info: (str: string) => void,
        warn: (str: string) => void
    }
}

/**
 * Class used by PvsProcess to detect pvs ready prompt and transform pvs lisp output to JSON objects.
 * TODO: use visitor pattern
 */
export class PvsLisp {
	private cmd: string = null;
	private pvsOut: string = "";
	private connection: Console = null;
	/**
	 * Constructor
	 * @param cmd {string} The command sent to pvs lisp.
	 */
	constructor (cmd: string, connection: Console) {
		this.cmd = cmd;
		this.connection = connection;
	}
	/**
	 * Parses pvs lisp output and transforms it into a JSON object. The function collects the pvs lisp output until the pvs ready prompt is detected.
	 * @param data {string} The PVS output to be parsed. 
	 * @param cb {function} Function given by the caller, invoked when the output is ready.
	 */
	parse(data: string, cb: (out: string) => void) {
		this.pvsOut += data;
		// see also regexp from emacs-src/ilisp/ilisp-acl.el
		const PVS_COMINT_PROMPT_REGEXP: RegExp = /\s*pvs\(\d+\):|([\w\W\s]*)\spvs\(\d+\):/g;
		const PVSIO_PROMPT: RegExp = /<PVSio>/g;
		const PROVER_PROMPT: RegExp = /\bRule\?/g;
		const QUERY_YES_NO: RegExp = /\?\s*\(Y or N\)|\?\s*\(Yes or No\)/gi;
		let ready: boolean = PVS_COMINT_PROMPT_REGEXP.test(data)
								|| PVSIO_PROMPT.test(data)
								|| PROVER_PROMPT.test(data)
								|| QUERY_YES_NO.test(data);
		PVS_COMINT_PROMPT_REGEXP.lastIndex = 0;
		PVSIO_PROMPT.lastIndex = 0;
		PROVER_PROMPT.lastIndex = 0;
		QUERY_YES_NO.lastIndex = 0;
		if (ready && cb) {
			// if (this.connection) { this.connection.console.info("Server ready!"); }
			const pvsOut: string = this.pvsOut;
			this.pvsOut = "";
			let ans: PvsResponseType = {
				error: null,
				res: null
			};
			if (pvsOut.includes(PVS_LISP_ERROR_RETURN_TO_TOP_LEVEL)) {
				const PVS_LISP_ERROR_REGEXP = /[\w\W\s]*(\d+):\s*Return to Top Level[\w\W\s]*/gim;
				const tmp = PVS_LISP_ERROR_REGEXP.exec(pvsOut);
				if (tmp && tmp.length === 2) {
					ans.error = {
						msg: pvsOut,
						restartOption: +tmp[1]
					};
				} else {
					this.connection.console.error("PVS responded with error message \n" + pvsOut);
				}
			}
			if (PROVER_PROMPT.test(pvsOut)) {
				let match: RegExpMatchArray =  /\w+\s*:([\w\W\s]+)\nRule\?/gi.exec(pvsOut);
				ans.res = match[1];
			} else if (QUERY_YES_NO.test(pvsOut)) {
				ans.res = pvsOut;
			} else {
				switch (this.cmd) {
					case "pvs-version-information": {
						const PVS_VERSION_INFO_REGEXP: { [s:string]: RegExp } = {
							brief: /"(\d+.?\d*)"[\s|nil]*"([^"]*)"/g,
							full: /"(\d+.?\d*)"[\s|nil]*"([^"]*)"\s*"(\d+.?\d*)([^"]*)/g
						};
						let info = PVS_VERSION_INFO_REGEXP.brief.exec(pvsOut);
						if (info && info.length > 2) {
							const pvsVersion: string = info[1];
							const lispVersion: string = info.slice(2).join(" ");
							ans.res = {
								pvsVersion: "PVS " + pvsVersion,
								lispVersion: lispVersion
							};
						} else {
							if (this.connection) { this.connection.console.warn("Unexpected pvs version response\n" + pvsOut); }
							ans.res = {
								pvsVersion: pvsOut,
								lispVersion: ""
							};
						}
						break;
					}
					case "pvs-init": {
						ans.res = "pvs process ready!";
						break;
					}
					case "parser-init": {
						ans.res = "parser ready!";
						break;
					}
					case "parse-file":
					case "json-typecheck-file":
					case "typecheck-file": {
						if (pvsOut.includes(PVS_LISP_ERROR_RETURN_TO_TOP_LEVEL)) {
							const PVS_PARSE_FILE_ERROR_REGEXP = /Parsing (.*)([\w\W\n]+)In file (\w*)\s*\(line (\d+), col (\d+)\)/gim;
							const tmp = PVS_PARSE_FILE_ERROR_REGEXP.exec(pvsOut);
							if (tmp && tmp.length === 6) {
								ans.error. parserError = {
									msg: tmp[2],
									fileName: tmp[3],
									line: +tmp[4],
									character: +tmp[5]
								};
							} else {
								if (this.connection) { this.connection.console.error("Unexpected parser error\n" + pvsOut); }
							}
						} else {
							ans.res = pvsOut;
						}
						break;
					}
					case "parse-expression": {
						if (pvsOut.includes(PVS_LISP_ERROR_RETURN_TO_TOP_LEVEL)) {
							const PVS_PARSE_EXPRESSION_ERROR_REGEXP = /[\w\W\s]*(\d+):\s*Return to Top Level[\w\W\s]*/gim;
							const tmp = PVS_PARSE_EXPRESSION_ERROR_REGEXP.exec(pvsOut);
							if (tmp && tmp.length === 2) {
								const error = {
									restartOption: tmp[1]
								};
								return cb(JSON.stringify({ error: error }));
							} else {
								if (this.connection) { this.connection.console.error("Unexpected expression parser response\n" + pvsOut); }
							}
						} else {
							const PVS_PARSE_EXPRESSION_REGEXP = /\s(id|number|string-value)\s*([^\s]*)\s/gim;
							let kind = "";
							if (pvsOut.includes(":instance allocation:")) {
								let tmp = pvsOut.split(":instance allocation:")[1];
								let info = PVS_PARSE_EXPRESSION_REGEXP.exec(tmp);
								if (info && info.length > 1) {
									kind = info[1];
								}
							}
							const res: ParseExpressionDescriptor = {
								kind: kind
							};
							ans.res = res;
						}
						break;
					}
					case "show-declaration": {
						// command defined in pvs-browser.el, line 82
						let res: PvsShowDeclarationInterface = {
							theoryName: null,
							declaration: null,
							comment: null
						}
						if (pvsOut.includes("The cursor is at the declaration")) {
							res.comment = "The cursor is already at the declaration for this identifier";
						} else if (pvsOut.includes("is a theory; to see it use C-c C-f")) {
							res.comment = "Theory"; 
						} else {
							const PVS_SHOW_DECLARATION_REGEXP: RegExp = /% From theory ([^:]*):([\s\w\W]*)nil/g;
							const info: string[] = PVS_SHOW_DECLARATION_REGEXP.exec(pvsOut);
							if (info && info.length > 2) {
								res.theoryName = info[1];
								res.declaration = info[2].trim();
							}
						}
						ans.res = res;
						break;
					}
					case "list-declarations":
					case "find-declaration": {
						// regexp for parsing the pvs lisp response
						const PVS_FIND_DECLARATION_REGEXP = {
							prelude: /\("[^"]*\s*"\s*"([^\s"]*)"\s*"([^\s"]*)"\s*([nil]*)\s*\((\d+\s*\d+\s*\d+\s*\d+)\)\s*"([^"]*)"\)/g,
							other: /\("[^"]*\s*"\s*"([^\s"]*)"\s*"([^\s"]*)"\s*"([^"]*)"*\s*\((\d+\s*\d+\s*\d+\s*\d+)\)\s*"([^"]*)"\)/g
						}
						// key is symbolFile.symbolTheory.symbolName, value is { symbolKind: string, symbolDeclaration: string, symbolDeclarationRange: vscode.Range }
						let declarations: PvsFindDeclarationInterface = {};
						let info = null;
						while (info = PVS_FIND_DECLARATION_REGEXP.prelude.exec(pvsOut)) {
							const symbolName: string = info[1];
							const symbolTheory: string = info[2];
							const symbolDeclarationFile: string = PRELUDE_FILE;
							const symbolDeclarationPosition = info[4].split(" ");
							const symbolDeclarationRange = {
								start: {
									line: +symbolDeclarationPosition[0],
									character: +symbolDeclarationPosition[1]
								},
								end: {
									line: +symbolDeclarationPosition[2],
									character: +symbolDeclarationPosition[3]
								}
							};
							const symbolDeclaration: string = info[5];
							declarations[getKey(symbolTheory, symbolName)] = {
								symbolName: symbolName,
								symbolTheory: symbolTheory,
								symbolDeclaration: symbolDeclaration,
								symbolDeclarationRange: symbolDeclarationRange,
								symbolDeclarationFile: symbolDeclarationFile
							};
						}
						while (info = PVS_FIND_DECLARATION_REGEXP.other.exec(pvsOut)) {
							const symbolName: string = info[1];
							const symbolTheory: string = info[2];
							const symbolDeclarationFile: string = info[3];
							const symbolDeclarationPosition = info[4].split(" ");
							const symbolDeclarationRange = {
								start: {
									line: +symbolDeclarationPosition[0],
									character: +symbolDeclarationPosition[1]
								},
								end: {
									line: +symbolDeclarationPosition[2],
									character: +symbolDeclarationPosition[3]
								}
							};
							const symbolDeclaration: string = info[5];
							declarations[getKey(symbolTheory, symbolName)] = {
								symbolName: symbolName,
								symbolTheory: symbolTheory,
								symbolDeclaration: symbolDeclaration,
								symbolDeclarationRange: symbolDeclarationRange,
								symbolDeclarationFile: symbolDeclarationFile
							};
						}
						ans.res = declarations;
						break;
					}
					case "list-theories": {
						// returns the list of theories in the current context
						// theories are grouped by filename
						let res: PvsTheoryListDescriptor = {
							folder: "",
							files: {},
							theories: {}
						};
						let collect_theories_regexp: RegExp = new RegExp(/\("([^"]+)"\s+"([^"]+)"\)/g); // capture group 1 is theory name, capture group 2 is filename
						let match: RegExpMatchArray = [];
						while(match = collect_theories_regexp.exec(pvsOut)) {
							let theoryName: string = match[1];
							let fileName: string = match[2];
							if (fileName.endsWith(".pvs")) {
								fileName = fileName.substr(0, fileName.length - 4);
							}
							res.files[fileName] = res.files[fileName] || [];
							res.files[fileName].push(match[1]);
							res.theories[theoryName] = res.theories[theoryName] || [];
							res.theories[theoryName].push(fileName);
						}
						collect_theories_regexp.lastIndex = 0;
						ans.res = res;
						break;
					}
					case "show-importchain": {
						let res: PvsShowImportChain = {
							theories: []
						};
						let show_importchain_regexp: RegExp = new RegExp(/Theory\s+([^\s]+) is /gi);
						let match: RegExpMatchArray = [];
						while(match = show_importchain_regexp.exec(pvsOut)) {
							res.theories.push(match[1]);
						}
						show_importchain_regexp.lastIndex = 0;
						ans.res = res;
						break;
					}
					case "show-tccs": {
						let res: TccDescriptor[] = [];
						// capture group 1: tcc one-liner message
						// capture group 2: tcc type
						// capture group 3: position (line) of the symbol that has triggered the tcc
						// capture group 4: position (column) of the symbol that has triggered the tcc
						// capture group 5: symbol that has triggered the tcc
						// capture group 6: tcc message (e.g., expected type list[int])
						// capture group 7: tcc status (e.g., unfinished)
						// capture group 8: tcc ID (name of the pvs theorem to be proved)
						// capture group 9: tcc formula (body of the pvs theorem to be proved)
						const regexp: RegExp = new RegExp(/((.+) generated \(at line (\d+), column (\d+)\) for\s+%?(.+))\s+%\s*(.*)\s+%\s*(.*)\s+(\w+):\s*OBLIGATION\s+([^%]+)/gi);
						let match: RegExpMatchArray = null;
						while (match = regexp.exec(pvsOut)) {
							if (match[3] && match[4]) {
								res.push({
									line: +match[3],
									character: +match[4],
									symbol: match[5],
									msg: match[6],
									status: match[7],
									id: match[8],
									formula: match[9]
								});
							}
						}
						ans.res = res;
						break;
					}
					case "change-context":
					case "current-context":
					case "disable-gc-printout":
					case "emacs-interface":
					case "pvs-continue":
					case "load-pvs-attachments":
					case "evaluation-mode-pvsio":
					case "install-prooflite-scripts":
					case "edit-proof-at":
					case "install-proof":
					case "prove-formula":
					default: {
						ans.res = pvsOut;
					}
				}
			}
			cb(JSON.stringify(ans));
		}
	}
}