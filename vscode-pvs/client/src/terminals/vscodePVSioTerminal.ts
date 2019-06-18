/**
 * @module VSCodePVSioTerminal
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

import * as vscode from 'vscode';
import * as path from 'path';
import { findTheoryName } from '../common/languageUtils';

function getPvsPath (): string {
    return vscode.workspace.getConfiguration().get("pvs.path");
}

class PVSioTerminal {
    pvsioExecutable: string;
    pvsPath: string;
    terminal: vscode.Terminal;
    constructor (fileName: string, theoryName: string) {
        const tname: string = `PVSio ${theoryName}`;
        this.pvsPath = getPvsPath();
        this.pvsioExecutable = path.join(this.pvsPath, "pvsio");
        const args: string[] = [ this.pvsioExecutable, fileName + "@" + theoryName ];
        this.terminal = vscode.window.createTerminal(tname, '/bin/bash', args);
        this.terminal.show();
    }
    printMessage(msg: string) {
        this.terminal.sendText("echo '" + msg + "'");
    }
}

export class VSCodePVSioTerminal {
    private pvsVersionInfo: string;
    constructor (pvsVersionInfo?: string) {
        this.pvsVersionInfo = pvsVersionInfo || "PVS";
    }
    activate (context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.commands.registerCommand('terminal.pvsio', () => {
            // the file extension needs to be removed from the filename
            let activeEditor: vscode.TextEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                let fileName: string = vscode.window.activeTextEditor.document.fileName;
                fileName = fileName.split(".").slice(0, -1).join(".");
                const text: string = vscode.window.activeTextEditor.document.getText();
                const line: number = vscode.window.activeTextEditor.selection.active.line;
                const theoryName: string = findTheoryName(text, line);
                const terminal: PVSioTerminal = new PVSioTerminal(fileName, theoryName);
            }
        }));
    }
}