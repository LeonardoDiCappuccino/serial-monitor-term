import { SerialPort } from 'serialport';

export interface PortInfo {
    path: string;
    manufacturer?: string;
    serialNumber?: string;
    pnpId?: string;
    locationId?: string;
    productId?: string;
    vendorId?: string;
}

export interface SerialPortInfo {

}

/**
 * List all available serial ports, filtering and prioritizing hardware serial ports
 */
export async function listSerialPorts(): Promise<PortInfo[]> {
    try {
        const ports = await SerialPort.list();
        
        // Keywords that indicate real hardware serial ports
        const preferredKeywords = [
            'USB Serial',
            'STM32',
            'FTDI',
            'CH340',
            'CH341',
            'CP210',
            'Prolific',
            'Arduino',
            'Serial Port',
            'UART',
            'USB-SERIAL',
            'VCP'
        ];
        
        // Keywords to exclude
        const excludeKeywords = [
            'Bluetooth',
            'BT',
        ];
        
        // Filter out excluded ports
        const filtered = ports.filter(port => {

            const searchText = [
                port.path,
                port.manufacturer,
                port.pnpId
            ].filter(Boolean).join(' ').toLowerCase();
            
            for (const keyword of excludeKeywords) {
                if (searchText.includes(keyword.toLowerCase())) {
                    return false;
                }
            }
            
            return true;
        });
        
        // Sort ports: preferred keywords first, then others
        return filtered.sort((a, b) => {

            const aText = [
                a.path,
                a.manufacturer,
                a.pnpId
            ].filter(Boolean).join(' ').toLowerCase();
            
            const aIsPreferred = preferredKeywords.some(keyword => 
                aText.includes(keyword.toLowerCase())
            );
            
            const bText = [
                b.path,
                b.manufacturer,
                b.pnpId
            ].filter(Boolean).join(' ').toLowerCase();
            
            const bIsPreferred = preferredKeywords.some(keyword => 
                bText.includes(keyword.toLowerCase())
            );
            
            // Preferred ports come first
            if (aIsPreferred && !bIsPreferred) {
                return -1;
            }
            if (!aIsPreferred && bIsPreferred) {
                return 1;
            }
            
            // Otherwise sort by port name
            return a.path.localeCompare(b.path);
        });
    } catch (error) {
        console.error('Error listing serial ports:', error);
        throw new Error(`Failed to list serial ports: ${error}`);
    }
}

/**
 * Check if a port is available
 */
export async function checkPortAvailability(path: string): Promise<boolean> {
    try {

        const port = new SerialPort({
            path,
            baudRate: 9600,
            autoOpen: false
        });

        return new Promise((resolve) => {
            port.open((err) => {
                if (err) {  // Port is blocked or unavailable
                    resolve(false);
                } else {    // Port is available, close it immediately
                    port.close(() => {
                        resolve(true);
                    });
                }
            });
        });

    } catch (error) {   // Any error means the port is not available
        return false;
    }
}