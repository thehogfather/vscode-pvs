import * as vscode from 'vscode';
import * as path from 'path';
import { findTheoryName } from '../common/languageUtils';

function getPvsPath (): string {
    const mode: string = vscode.workspace.getConfiguration().get("pvs.zen-mode");
    if (mode === "pvs-6" || mode === "pvs-7") {
        return vscode.workspace.getConfiguration().get(`pvs.zen-mode:${mode}-path`);
    }
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