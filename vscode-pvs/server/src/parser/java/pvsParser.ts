/**
 * @module PvsParser (Java target)
 * @author Paolo Masci
 * @date 2019.12.27
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

import { spawn, ChildProcess, execSync, execFileSync, execFile } from 'child_process';
// note: ./common is a symbolic link. if vscode does not find it, try to restart TS server: CTRL + SHIFT + P to show command palette, and then search for Typescript: Restart TS Server
import { 
	PvsParserResponse, PvsVersionDescriptor,
	SimpleConnection
} from '../../common/serverInterface'
import * as path from 'path';
import * as fsUtils from '../../common/fsUtils';
import { Diagnostic } from 'vscode-languageserver';

export class PvsParser {

    /**
     * Parse a pvs file
     * @param desc File descriptor, includes file name, file extension, and context folder
     */
    async parseFile (desc: { fileName: string, fileExtension: string, contextFolder: string }): Promise<Diagnostic[]> {
        const fname: string = fsUtils.desc2fname(desc);
        console.info(`[vscode-pvs-parser] Parsing ${fname}`);

        let diagnostics: Diagnostic[] = [];
        const parserFolder: string = __dirname;

        const start: number = Date.now();
		// const cmd: string = `cd ${parserFolder} && java -classpath ../antlr-4.7.2-complete.jar:./ org.antlr.v4.gui.TestRig PvsLanguage parse ${fname}`;
        // const cmd: string = `cd ${parserFolder} && java -classpath ../antlr-4.7.2-complete.jar:./ PvsParser ${fname}`; // this will produce a JSON object of type Diagnostic[]
        const cmd: string = `cd ${parserFolder} && java -jar PvsParser.jar ${fname}`; // this will produce a JSON object of type Diagnostic[]
        try {
            const errors: Buffer = execSync(cmd);
            const stats: number = Date.now() - start;
            if (errors && errors.length > 0) {
                const res: string = errors.toLocaleString();
                console.log(res);
                diagnostics = JSON.parse(res);
                console.log(`[vscode-pvs-parser] File ${desc.fileName}${desc.fileExtension} contains errors`);
            } else {
                console.log(`[vscode-pvs-parser] File ${desc.fileName}${desc.fileExtension} parsed successfully in ${stats}ms`);
            }
        } catch (relocateError) {
            console.log(relocateError);
        } finally {
            // console.log(`[vscode-pvs-parser] Sending diagnostics for ${desc.fileName}${desc.fileExtension}`);
            if (diagnostics && diagnostics.length > 0) {
                console.dir(diagnostics, { depth: null });
            }
            return diagnostics;
        }
	}
}