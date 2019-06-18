/**
 * @module VSCodePvsEmacsBindingsProvider
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

/**
 * PVS emacs bindings:
 * - typecheck: M-x tc
 * - typecheck-prove: M-x tcp
 * - prove: M-x prove
 * - show tccs: M-x tccs
 * - pvsio: M-x pvsio
 * - view prelude: M-x view-prelude-file
 */
import { ExtensionContext, commands, window, Disposable, TextDocument, InputBox, QuickInputButtons } from 'vscode';
import { LanguageClient } from 'vscode-languageclient';
import { findTheoryName } from '../common/languageUtils';
import { workspace } from 'vscode';

const cmds: string[] = [
	"tc", "typecheck",
	"tcp", "typecheck-prove",
	//"pr", 
	"prove",
	"show-tccs",
	"pvsio",
	"step-proof",
	"pvs7", "pvs6"
];

export class VSCodePvsEmacsBindingsProvider {
	private client: LanguageClient;
	private inputBox: InputBox;
	private metax: string = "M-x ";
	private userInput: string; // used by autocompletion

	constructor (client: LanguageClient) {
		this.client = client;
	}
	private autocompleteInput(input: string): string {
		if (input) {
			for (const i in cmds) {
				if (cmds[i].startsWith(input)) {
					return cmds[i];
				}
			}
		}
		return input;
	}
	private onDidAccept(userInput) {
		if (userInput) {
			userInput = userInput.toLowerCase();
			// const document: TextDocument = window.activeTextEditor.document;
			switch (userInput) {
				case "pvs6": {
					const v6: string = workspace.getConfiguration().get(`pvs.zen-mode:pvs-6-path`);
					this.client.sendRequest('pvs.restart', { pvsPath: v6 });
					break;
				}
				case "pvs7": {
					const v7: string = workspace.getConfiguration().get(`pvs.zen-mode:pvs-7-path`);
					this.client.sendRequest('pvs.restart', { pvsPath: v7 });
					break;
				}
				case "tc": 
				case "typecheck": {
					// typecheck current file
					this.client.sendRequest('pvs.typecheck-file-and-show-tccs', window.activeTextEditor.document.fileName);
					// commands.executeCommand("terminal.pvs.typecheck");
					// this.client.sendRequest('pvs.typecheck-file', {
					// 	fileName: document.fileName
					// });
					break;
				}
				case "tcp": 
				case "typecheck-prove": {
					this.client.sendRequest('pvs.typecheck-prove-and-show-tccs', window.activeTextEditor.document.fileName);
					// commands.executeCommand("terminal.pvs.typecheck-prove");
					break;
				}
				case "pr":
				case "prove": {
					// open pvs terminal
					commands.executeCommand("terminal.pvs.prove");
					break;
				}
				case "show-tccs": {
					const fileName: string = window.activeTextEditor.document.fileName;
					const line: number = window.activeTextEditor.selection.active.line;
					const text: string = window.activeTextEditor.document.getText();
					const theoryName: string = findTheoryName(text, line);
					if (theoryName) {
						this.client.sendRequest('pvs.typecheck-file-and-show-tccs', [ fileName, theoryName ]);
					} else {
						window.showErrorMessage("Unable to identify theory at line " + line);
					}
					break;
				}
				case "pvsio": {
					// open pvsio terminal
					commands.executeCommand("terminal.pvsio");
					break;
				}
				case "step-proof": {
					// open pvs terminal
					commands.executeCommand("terminal.pvs.prove");
					break;
				}
				default: {}
			}
		}
	}
	activate (context: ExtensionContext) {
		let cmd: Disposable = commands.registerCommand("pvsemacs.M-x", () => {
			window.setStatusBarMessage("M-x", 2000);
			// window.showInputBox({
			// 	prompt: "M-x ",
			// }).then((userInput: string) => {
			this.inputBox = window.createInputBox();
			this.inputBox.prompt = this.metax;
			this.inputBox.onDidAccept(() => {
				this.onDidAccept(this.userInput);
				this.inputBox.dispose();
			});
			this.inputBox.onDidChangeValue((input: string) => {
				// FIXME: VSCode does not seem to capture tabs in the input box??
				this.userInput = this.autocompleteInput(input);
				this.inputBox.prompt = this.metax + this.userInput;
			});
			this.inputBox.show();
		});
		context.subscriptions.push(cmd);
	}
}