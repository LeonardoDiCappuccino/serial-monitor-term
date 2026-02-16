import * as vscode from 'vscode';
import { listSerialPorts, checkPortAvailability, PortInfo } from './serialPortUtils';
import { SerialMonitorTerminal } from './SerialMonitorTerminal';

export function activate(context: vscode.ExtensionContext) {
	console.log('Serial Monitor Terminal extension is now active!');

	const disposable = vscode.commands.registerCommand('serial-monitor-term.openMonitor', async () => {
		try {
			// Select serial port
			const selectedPort = await selectSerialPort();
			if (!selectedPort) {
				return; // User cancelled
			}

			// Select baud rate
			const selectedBaudRate = await selectBaudRate();
			if (!selectedBaudRate) {
				return; // User cancelled
			}

			// Create and show serial monitor terminal
			const serialMonitor = new SerialMonitorTerminal(selectedPort.path, selectedBaudRate);
			const terminal = vscode.window.createTerminal({
				name: `${selectedPort.path} - Serial Monitor`,
				pty: serialMonitor
			});
			terminal.show();

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to open serial monitor: ${errorMessage}`);
		}
	});

	context.subscriptions.push(disposable);
}

interface PortQuickPickItem extends vscode.QuickPickItem {
	port: PortInfo;
}

async function selectSerialPort(): Promise<PortInfo | undefined> {
	try {
		const ports = await listSerialPorts();

		if (ports.length === 0) {
			vscode.window.showWarningMessage('No serial ports found. Please connect a device and try again.');
			return undefined;
		}

		// Check availability for each port and create QuickPick items
		const items: PortQuickPickItem[] = [];
		
		for (const port of ports) {
			const isAvailable = await checkPortAvailability(port.path);
			
			// Build label with warning icon if blocked
			const warningPrefix = isAvailable ? '' : '⚠️ ';
			
			let deviceName = port.manufacturer;
			
			// A more friendly name may be available
			const portAny = port as any;
			if (portAny.friendlyName) {
				deviceName = portAny.friendlyName;
			}
			
			// Check if deviceName already includes the COM port (Windows friendlyName often does)
			const label = deviceName
				? (deviceName.includes(port.path) 
					? `${deviceName}` 
					: `${deviceName} (${port.path})`)
				: `${port.path}`;
			
			// Build hardware ID detail line
			const hwParts: string[] = [];

			if (port.vendorId && port.productId) {
				hwParts.push(`VID:PID=${port.vendorId}:${port.productId}`);
			}

			if (port.serialNumber) {
				hwParts.push(`SER=${port.serialNumber}`);
			}

			if (port.locationId) {
				hwParts.push(`LOCATION=${port.locationId}`);
			}
			
			items.push({
				label: `${warningPrefix}${label}`,
				detail: hwParts.length > 0 ? `Hardware ID: USB ${hwParts.join(' ')}` : undefined,
				port
			});
		}

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select a serial port',
			title: 'Serial Monitor - Port Selection'
		});

		if (selected) {
			return selected.port;
		}

		return undefined;

	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`Failed to list serial ports: ${errorMessage}`);
		return undefined;
	}
}

async function selectBaudRate(): Promise<number | undefined> {
	const baudRates = [
		{ label: '300', value: 300},
		{ label: '1200', value: 1200 },
		{ label: '2400', value: 2400 },
		{ label: '9600', value: 9600 },
		{ label: '19200', value: 19200 },
		{ label: '38400', value: 38400 },
		{ label: '57600', value: 57600 },
		{ label: '115200', value: 115200, picked: true }, 
		{ label: '230400', value: 230400 },
		{ label: '460800', value: 460800 },
		{ label: '921600', value: 921600 }
	];

	const items: vscode.QuickPickItem[] = baudRates.map(rate => ({
		label: rate.label,
		description: rate.picked ? '(default)' : '',
		picked: rate.picked
	}));

	const selected = await new Promise<vscode.QuickPickItem | undefined>((resolve) => {
		const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem>();
		quickPick.items = items;
		quickPick.canSelectMany = false;
		quickPick.placeholder = 'Select baud rate';
		quickPick.title = 'Serial Monitor - Baud Rate Selection';
		quickPick.activeItems = items.filter(item => item.picked);

		quickPick.onDidAccept(() => {
			resolve(quickPick.selectedItems[0]);
			quickPick.hide();
		});
		quickPick.onDidHide(() => {
			resolve(undefined);
			quickPick.dispose();
		});

		quickPick.show();
	});

	return selected ? parseInt(selected.label) : undefined;
}

export function deactivate() {}
