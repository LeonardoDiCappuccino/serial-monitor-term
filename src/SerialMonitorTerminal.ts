import * as vscode from 'vscode';
import { SerialPort } from 'serialport';

const NO_COLOR = '\x1b[0m';
const GREEN = '\x1b[1;36m';
const YELLOW = '\x1b[1;33m';

export class SerialMonitorTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number>();

    public readonly onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    public readonly onDidClose: vscode.Event<number> = this.closeEmitter.event;

    private port: SerialPort | null = null;
    private inputLine: string = '';

    private isClosing = false;
    private isConnected = true;
    private exitPending = false;

    private cursorVerPos = 0;
    private rowCont: number = 0;

    constructor(
        private readonly portPath: string,
        private readonly baudRate: number
    ) { }

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.openSerialPort();

        if (initialDimensions) {
            this.setDimensions(initialDimensions);
        }

        // this.writeEmitter.fire('\x1b[?25l');    // hiding cursor
        this.writeHeader();
    }

    close(): void {
        this.isClosing = true;
        this.isConnected = false;

        if (this.port) {
            if (this.port.isOpen) {
                this.port.removeAllListeners();
                this.port.close((err) => {
                    if (err) {
                        console.error('Error closing port:', err);
                    }
                });
            }
            this.port = null;
        }

        const exitMsg = `${YELLOW}[CONNECTION CLOSED - Press any key to close terminal]${NO_COLOR}`;
        this.writeOnBottom(exitMsg);
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        
        this.rowCont = dimensions.rows;

        if (this.isConnected) {
            this.writeInputLine();
        } else {
            this.writeDisconnectMsg();
        }
    }

    handleInput(data: string): void {
        // If exit is pending, any key press closes the terminal
        if (this.exitPending) {
            this.closeEmitter.fire(0);
            return;
        }

        // Ctrl-X: Exit but keep terminal open
        if (data === '\x18') {
            this.exitPending = true;
            this.close();
            return;
        }

        // Ctrl-C: Clear everything and show only input line
        if (data === '\x03') {
            this.writeOnScreen('\x1b[2J\x1b[3J\x1b[H'); // Clear screen and go to top
            this.cursorVerPos = 0;

            this.writeHeader();

            if (this.isConnected) {
                this.writeInputLine();
            } else {
                this.writeDisconnectMsg();
            }

            return;
        }

        if (!this.isConnected) {
            return;
        }

        // Enter key - send newline and clear input
        if (data === '\r') {
            if (this.port && this.port.isOpen) {
                this.port.write('\r\n');
            }
            this.inputLine = '';
            this.writeInputLine();
        }

        // Backspace: Remove last character from input line
        if (data === '\x7f' || data === '\b') {
            if (this.inputLine.length > 0) {
                this.inputLine = this.inputLine.slice(0, -1);
                this.writeInputLine();
            }
            return;
        }

        // Handle regular input
        if (data.length === 1 && data >= ' ' && data <= '~') {
            this.inputLine += data;

            // Send to serial port immediately
            if (this.port && this.port.isOpen) {
                this.port.write(data);
            }

            this.writeInputLine();
        }
    }

    private async openSerialPort(): Promise<void> {
        try {
            this.port = new SerialPort({
                path: this.portPath,
                baudRate: this.baudRate,
                dataBits: 8,
                parity: 'none',
                stopBits: 1
            });

            this.port.on('data', (data: Buffer) => {
                this.handleSerialData(data);
            });

            this.port.on('error', (err: Error) => {
                this.handleError(err);
            });

            this.port.on('close', () => {
                if (!this.isClosing) {
                    this.handleDisconnect();
                }
            });

            this.port.on('open', () => {
            });

        } catch (error) {
            this.handleError(error as Error);
        }
    }

    private readingRest: string = "";
    private handleSerialData(data: Buffer): void {
        // Convert buffer to string and strip non-printable characters except CR, LF, TAB
        let text = this.readingRest + data.toString('utf8').replace(/(?<!\r)\n/g, '\r\n');
        // text = text.replace(/[^\x20-\x7E\r\n\t]/g, '');

        this.readingRest = '';

        if (text.endsWith('\n')) {
            // Write the serial data exactly as received
            this.writeOnScreen(text);
        } else {
            const lines = text.split('\n');
            let splitData = lines.slice(0, -1).join('\n');
            if (splitData !== '') {
                this.writeEmitter.fire(splitData + '\n');
            }
            this.readingRest = lines.at(-1) ?? '';
        }

        // Update
        // this.writeInputLine();
    }

    private handleDisconnect(): void {
        if (this.isClosing) {
            return;
        }

        this.isConnected = false;

        this.writeDisconnectMsg();

        this.attemptReconnect(100);
    }

    private attemptReconnect(delay: number): void {
        setTimeout(() => {
            if (this.isClosing || !this.port) {
                return;
            }

            this.port.open((err) => {
                if (err) {
                    // Reconnection failed
                    this.attemptReconnect(delay);
                } else {
                    // Reconnected
                    this.isConnected = true;
                    this.writeInputLine();
                }
            });
        }, delay);
    }

    private handleError(error: Error): void {
        const errorMsg = `\x1b[1;31m[ERROR] ${error.message}${NO_COLOR}`;

        this.writeOnScreen('\r\n' + errorMsg + '\r\n');

        this.close();
    }

    private writeOnScreen(data: string) {
        for (var i = 0; i < data.length; i++) {
            var char = data.charAt(i);

            if (char === '\n') {
                this.cursorVerPos += 1;

                if (this.cursorVerPos >= this.rowCont - 1) {
                    this.cursorVerPos--;
                    const prompt = `${GREEN}>${NO_COLOR} ${this.inputLine}`;
                    this.writeEmitter.fire(`\x1b[s\n\x1b[2K\r\n${prompt}\x1b[u\x1b[B`);
                    // this.writeInputLine();
                    return;
                }
            }

            this.writeEmitter.fire(data[i]);
        }

    }

    private writeOnBottom(data: string): void {
        this.writeEmitter.fire('\x1b[s'); // Save cursor position
        this.writeEmitter.fire('\x1b[999;0H\x1b[2K'); // Move to bottom
        this.writeEmitter.fire(data);
        this.writeEmitter.fire('\x1b[u'); // Restore cursor position
    }

    private writeHeader(): void {

        const portInfo = `Port: ${this.portPath} | Baud: ${this.baudRate}`;
        const controls = `\x1b[33mCtrl-C${NO_COLOR}: Clear | \x1b[33mCtrl-X${NO_COLOR}: Exit`;


        // Build header
        const contentLine = `${GREEN}│${NO_COLOR}   ${portInfo} | ${controls}   ${GREEN}│${NO_COLOR}`;

        // Strip ANSI codes for length calculation
        const headerWidth = contentLine.replace(/\x1b\[[0-9;]*m/g, '').length;

        const title = 'Serial Monitor'
        const topLine = `${GREEN}┌─ ${title} ${'─'.repeat(headerWidth - title.length - 5)}┐${NO_COLOR}`;

        const bottomLine = `${GREEN}└${'─'.repeat(headerWidth - 2)}┘${NO_COLOR}`;

        this.writeOnScreen(topLine + '\r\n' + contentLine + '\r\n' + bottomLine + '\r\n');
    }

    private writeDisconnectMsg() {
        const msg = `${YELLOW}[DISCONNECTED - Waiting for device...]${NO_COLOR}`;
        this.writeOnBottom(msg);
    }

    private writeInputLine(): void {
        if (!this.isConnected) {
            return;
        }

        const prompt = `${GREEN}>${NO_COLOR} ${this.inputLine}`;
        this.writeOnBottom(prompt);
    }

}