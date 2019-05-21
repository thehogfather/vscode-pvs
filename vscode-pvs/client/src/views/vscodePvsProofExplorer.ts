import { ExtensionContext, TreeItemCollapsibleState, commands, window, TextDocument, 
			Uri, Range, Position, TreeItem, Command, EventEmitter, Event,
			TreeDataProvider, workspace, MarkdownString, TreeView, Disposable } from 'vscode';
import { LanguageClient } from 'vscode-languageclient';
import { ProofDescriptor, ProofStructure } from '../common/serverInterface';

/**
 * Definition of tree items
 */
class ProofItem extends TreeItem {
	static uid: number = 0;
	contextValue: string = "proofItem";
	name: string; // prover command
	command: Command; // vscode action
	children: ProofItem[];
	constructor (type: string, name: string, collapsibleState?: TreeItemCollapsibleState) {
		super(type, (collapsibleState === undefined) ? TreeItemCollapsibleState.Expanded : collapsibleState);
		this.contextValue = type;
		this.id = (ProofCommand.uid++).toString();
		this.name = name;
		this.notVisited();
	}
	notVisited () {
		this.tooltip = `${this.contextValue} ${this.name}`;
		this.label = this.name;
	}
	visited () {
		this.tooltip = "executed";
		this.label = `🔹${this.name}`;
	}
	active () {
		this.tooltip = "ready to execute";
		this.label = `🔸${this.name}`;
	}
	setChildren (children: ProofItem[]) {
		this.children = children;
	}
	appendChild (child: ProofItem) {
		this.children = this.children || [];
		this.children.push(child);
	}
	getChildren (): ProofItem[] {
		return this.children;
	}
}
class ProofCommand extends ProofItem {
	constructor (cmd: string, collapsibleState?: TreeItemCollapsibleState) {
		super("proof-command", cmd);
		this.id = (ProofCommand.uid++).toString();
		this.name = cmd;
		this.notVisited();
		// this.tooltip = "Click to run " + this.contextValue;
		this.command = {
			title: this.contextValue,
			command: "explorer.didClickOnStrategy",
			arguments: [ this.contextValue ]
		};
	}
}
class ProofBranch extends ProofItem {
	constructor (cmd: string, collapsibleState?: TreeItemCollapsibleState) {
		super("proof-branch", cmd);
		this.id = (ProofCommand.uid++).toString();
		this.name = cmd;
		this.notVisited();
		// this.tooltip = "Click to run " + this.contextValue;
		this.command = {
			title: this.contextValue,
			command: "explorer.didClickOnStrategy",
			arguments: [ this.contextValue ]
		};
	}
}
class RootNode extends ProofItem {
	constructor (cmd: string, collapsibleState?: TreeItemCollapsibleState) {
		super("root", cmd);
		this.id = (ProofCommand.uid++).toString();
		this.name = cmd;
		this.notVisited();
		// this.tooltip = "Click to run " + this.contextValue;
		this.command = {
			title: this.contextValue,
			command: "explorer.didClickOnStrategy",
			arguments: [ this.contextValue ]
		};
	}
}

// https://emojipedia.org/symbols/
//  ❌ 🔵 ⚫ ⚪ 🔴 🔽 🔼 ⏯ ⏩ ⏪ ⏫ ⏬ ⧐ ▶️ ◀️ ⭕ 🔹🔸💠🔷🔶


/**
 * Data provider for PVS Proof Explorer view
 */
export class VSCodePvsProofExplorer implements TreeDataProvider<TreeItem> {
	/**
	 * Events for updating the tree structure
	 */
	private _onDidChangeTreeData: EventEmitter<TreeItem> = new EventEmitter<TreeItem>();
	readonly onDidChangeTreeData: Event<TreeItem> = this._onDidChangeTreeData.event;

	// private proverCommands: ProverCommands;

	/**
	 * Language client for communicating with the server
	 */
	private client: LanguageClient;

	/**
	 * Name of the view associated with the data provider
	 */
	private providerView: string;
	private view: TreeView<TreeItem>
	private root: ProofItem;
	private desc: ProofDescriptor;
	private index: { [ key: string ]: {
		nextCommand?: ProofItem;
	}} = {};

	private activeCommand: ProofCommand;

	private getActiveCommand (): ProofCommand {
		if (!this.activeCommand) {
			this.activeCommand = (this.root && this.root.children && this.root.children.length > 0) ? <ProofCommand> this.root.children[0] : null;
		}
		return this.activeCommand;
	}

	private getFirstCommand (): ProofCommand {
		this.activeCommand = (this.root && this.root.children && this.root.children.length > 0) ? <ProofCommand> this.root.children[0] : null;
		return this.activeCommand;
	}

	// private getNextCommand (): ProofCommand {
	// 	// TODO
	// }

	/**
	 * @constructor
	 * @param client Language client 
	 * @param providerView VSCode view served by the data provider
	 */
	constructor(client: LanguageClient, providerView: string) {
		this.client = client;
		this.providerView = providerView;
		// register tree view.
		// use window.createTreeView instead of window.registerDataProvider -- this allows to perform UI operations programatically. 
		// window.registerTreeDataProvider(this.providerView, this);
		this.view = window.createTreeView(this.providerView, { treeDataProvider: this });
		// this.proverCommands = new ProverCommands();
	}

	/**
	 * Refresh tree view
	 */
	private refreshView(): void {
		this._onDidChangeTreeData.fire();
	}

	/**
	 * Resets the tree view
	 */
	private resetView () {
	}

	private fromJSON (json: ProofStructure) {
		function makeTree(elem: { id: string, children: any[], type: string }, parent: ProofCommand) {
			const node: ProofItem = (elem.type === "proof-command") ? new ProofCommand(elem.id) : 
										(elem.type === "proof-branch") ? new ProofBranch(elem.id)
										: new RootNode(elem.id);
			parent.appendChild(node);
			if (elem.children && elem.children.length) {
				elem.children.forEach(child => {
					makeTree(child, node);
				});
			} else {
				node.collapsibleState = TreeItemCollapsibleState.None;
			}
		}
		if (json && json.proof && json.desc) {
			const cmd: ProofCommand = new ProofCommand(json.proof.id);
			this.root = cmd; // this is the proof name
			if (json.proof.children && json.proof.children.length) {
				json.proof.children.forEach(child => {
					makeTree(child, cmd);
				});
			} else {
				cmd.collapsibleState = TreeItemCollapsibleState.None;
			}
			this.desc = json.desc;
		}
		// update front-end
		this.refreshView();
	}


	/**
	 * Handlers for messages received from the server
	 */
	private installHandlers(context: ExtensionContext) {
		this.client.onRequest('server.response.step-proof', (ans: string) => {
			// let root: ProofItem = new VDashItem("root", TreeItemCollapsibleState.Expanded);
			// this.nodes.set("root", root);
			this.fromJSON(JSON.parse(ans));
		});

		this.client.onRequest("server.response.prover", (ans) => {
		});
	}

	
	/**
	 * Handler activation function
	 * @param context Client context 
	 */
	activate(context: ExtensionContext) {
		this.installHandlers(context);
		// this.proverCommands.activate(context);

		let cmd: Disposable = commands.registerCommand("proof-explorer.step", () => {
			const activeCommand: ProofCommand = this.getActiveCommand();
			const cmd: string = activeCommand.name;
			commands.executeCommand("terminal.pvs.send-proof-command", {
				fileName: this.desc.fileName, theoryName: this.desc.theoryName, formulaName: this.desc.formulaName, line: this.desc.line, cmd
			});
		});
		context.subscriptions.push(cmd);
		cmd = commands.registerCommand("terminal.pvs.response.step-executed", () => {
			const activeCommand: ProofCommand = this.getActiveCommand();
			activeCommand.visited();
			this.refreshView();
		});
		context.subscriptions.push(cmd);
		cmd = commands.registerCommand("terminal.pvs.response.step-proof-ready", () => {
			const activeCommand: ProofCommand = this.getFirstCommand();
			activeCommand.active();
			this.refreshView();
		});
		context.subscriptions.push(cmd);


		// create sample proof tree
		// let root: ProofItem = new VDashItem("root");
		// let node1: ProofItem = new SkosimpStar("node1");
		// let node2: ProofItem = new VDashItem("node2");
		// let node3: ProofItem = new Expand("node3", "per_release_fup");
		// let node4: ProofItem = new VDashItem("node4");
		// let node5: ProofItem = new Split("node5");
		// let node5_1: ProofItem = new VDashItem("node5.1");
		// let node5_2: ProofItem = new VDashItem("node5.2");
		// let node5_3: ProofItem = new VDashItem("node5.3");
		// let node5_4: ProofItem = new VDashItem("node5.4");
		// let node5_1_1: ProofItem = new Grind("node5.1.1");
		// let node5_2_1: ProofItem = new Grind("node5.2.1");
		// let node5_3_1: ProofItem = new Grind("node5.3.1");
		// let node5_4_1: ProofItem = new Grind("node5.4.1");
		// root.setChildren([ node1 ]);
		// node1.setChildren([ node2 ]);
		// node2.setChildren([ node3 ]);
		// node3.setChildren([ node4 ]);
		// node4.setChildren([ node5 ]);
		// node5.setChildren([ node5_1, node5_2, node5_3, node5_4 ]);
		// node5_1.setChildren([ node5_1_1 ]);
		// node5_2.setChildren([ node5_2_1 ]);
		// node5_3.setChildren([ node5_3_1 ]);
		// // node5_4.setChildren([ node5_4_1 ]);
		// node5_1_1.proved();
		// node5_2_1.failed();
		// node5_3_1.proved();
		// // node5_4_1.proved();
		// this.nodes.set("root", root);
	}

	/**
	 * Returns the list of theories defined in the active pvs file
	 * @param element Element clicked by the user 
	 */
	getChildren(element: TreeItem): Thenable<TreeItem[]> {
		if (element) {
			let children: TreeItem[] = (<ProofItem> element).getChildren();
			return Promise.resolve(children);
		}
		// root node: show the list of theories from the selected file
		return Promise.resolve([ this.root ]);
	}

	getTreeItem(element: TreeItem): TreeItem {
		return element;
	}

}