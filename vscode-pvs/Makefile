# Makefile for vscode-pvs
 # @author Paolo Masci
 # @date 2019.06.18
 # @copyright 
 # Copyright 2019 United States Government as represented by the Administrator 
 # of the National Aeronautics and Space Administration. All Rights Reserved.
 #
 # Disclaimers
 #
 # No Warranty: THE SUBJECT SOFTWARE IS PROVIDED "AS IS" WITHOUT ANY
 # WARRANTY OF ANY KIND, EITHER EXPRESSED, IMPLIED, OR STATUTORY,
 # INCLUDING, BUT NOT LIMITED TO, ANY WARRANTY THAT THE SUBJECT SOFTWARE
 # WILL CONFORM TO SPECIFICATIONS, ANY IMPLIED WARRANTIES OF
 # MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR FREEDOM FROM
 # INFRINGEMENT, ANY WARRANTY THAT THE SUBJECT SOFTWARE WILL BE ERROR
 # FREE, OR ANY WARRANTY THAT DOCUMENTATION, IF PROVIDED, WILL CONFORM TO
 # THE SUBJECT SOFTWARE. THIS AGREEMENT DOES NOT, IN ANY MANNER,
 # CONSTITUTE AN ENDORSEMENT BY GOVERNMENT AGENCY OR ANY PRIOR RECIPIENT
 # OF ANY RESULTS, RESULTING DESIGNS, HARDWARE, SOFTWARE PRODUCTS OR ANY
 # OTHER APPLICATIONS RESULTING FROM USE OF THE SUBJECT SOFTWARE.
 # FURTHER, GOVERNMENT AGENCY DISCLAIMS ALL WARRANTIES AND LIABILITIES
 # REGARDING THIRD-PARTY SOFTWARE, IF PRESENT IN THE ORIGINAL SOFTWARE,
 # AND DISTRIBUTES IT "AS IS."
 #
 # Waiver and Indemnity: RECIPIENT AGREES TO WAIVE ANY AND ALL CLAIMS
 # AGAINST THE UNITED STATES GOVERNMENT, ITS CONTRACTORS AND
 # SUBCONTRACTORS, AS WELL AS ANY PRIOR RECIPIENT.  IF RECIPIENT'S USE OF
 # THE SUBJECT SOFTWARE RESULTS IN ANY LIABILITIES, DEMANDS, DAMAGES,
 # EXPENSES OR LOSSES ARISING FROM SUCH USE, INCLUDING ANY DAMAGES FROM
 # PRODUCTS BASED ON, OR RESULTING FROM, RECIPIENT'S USE OF THE SUBJECT
 # SOFTWARE, RECIPIENT SHALL INDEMNIFY AND HOLD HARMLESS THE UNITED
 # STATES GOVERNMENT, ITS CONTRACTORS AND SUBCONTRACTORS, AS WELL AS ANY
 # PRIOR RECIPIENT, TO THE EXTENT PERMITTED BY LAW.  RECIPIENT'S SOLE
 # REMEDY FOR ANY SUCH MATTER SHALL BE THE IMMEDIATE, UNILATERAL
 # TERMINATION OF THIS AGREEMENT.
 
all:
	make install
	cd server && npm install --no-save typescript && npm run compile && npm install
	cd client && npm install --no-save typescript && npm run compile && npm install
	make core

release:
	npm install
	cd server && npm install --no-save typescript && npm run compile && npm install
	cd client && npm install --no-save typescript && npm run compile && npm install
	make core
	npm install --no-save vsce && node_modules/vsce/out/vsce package

install:
	npm install && npm install --no-save jasmine ts-node jasmine-ts

test-proxy:
	node_modules/jasmine-ts/lib/index.js --config=server/test/specs/jasmine-test-proxy.json
test-parser:
	node_modules/jasmine-ts/lib/index.js --config=server/test/specs/jasmine-test-parser.json
test-find-declaration:
	node_modules/jasmine-ts/lib/index.js --config=server/test/specs/jasmine-test-find-declaration.json
test-typechecker:
	node_modules/jasmine-ts/lib/index.js --config=server/test/specs/jasmine-test-typechecker.json
test-prover:
	node_modules/jasmine-ts/lib/index.js --config=server/test/specs/jasmine-test-prover.json
test-workspace:
	node_modules/jasmine-ts/lib/index.js --config=server/test/specs/jasmine-test-workspace.json
test:
	node_modules/jasmine-ts/lib/index.js --config=server/test/specs/jasmine-test-all.json
test-all: test

core:
	-mkdir server/out && mkdir server/out/core
	cd server/src/core/ && make

pvs-language:
	-mkdir server/out && mkdir server/out/core
	cd server/src/core/ && make pvs

clean:
	cd client && make clean && cd .. && cd server && make clean && cd ..
	rm -rf node_modules
	rm -f vscode-pvs-*.vsix
