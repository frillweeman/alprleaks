import * as net from 'net';
import * as fs from 'fs';
import { createObjectCsvWriter } from 'csv-writer';

const FEED_PORT = 8080;
const FEED_IR_PATH = '/cam{n}ir';
const FEED_COLOR_PATH = '/cam{n}color';
const DATA_PORT = 5001;
const OUTPUT_DIR = `${__dirname}/../output`;

interface Hit {
  uuid: string;
  systemId: string;
  timestamp: string;
  make: string;
  model: string;
  color: string;
  licensePlateNumber: string;
  filename: string;
}

const systems: string[] = [
  '166.152.44.39',
  '166.152.44.38',
  '166.152.44.40'
];

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

const csvWriter = createObjectCsvWriter({
  path: `${OUTPUT_DIR}/output.csv`,
  header: [
    { id: 'uuid', title: 'UUID' },
    { id: 'systemId', title: 'System ID' },
    { id: 'timestamp', title: 'Timestamp' },
    { id: 'make', title: 'Make' },
    { id: 'model', title: 'Model' },
    { id: 'color', title: 'Color' },
    { id: 'licensePlateNumber', title: 'License Plate Number' },
    { id: 'imagePath', title: 'Image Path' }
  ]
});

systems.forEach((host) => {
  const port = DATA_PORT;
  const client = new net.Socket();
  let messageBuffer: Buffer = Buffer.alloc(0);

  client.connect(port, host, () => {
    console.log(`Connected to ${host}:${port}`);
  });

  const handleData = (data: Buffer) => {
    messageBuffer = Buffer.concat([messageBuffer, data]);
    const messageEnd = `"UseCacheGPS": "1"`;

    while (true) {
      const messageEndIndex = messageBuffer.indexOf(messageEnd);
      if (messageEndIndex !== -1) {
        const completeMessage = messageBuffer.slice(0, messageEndIndex + messageEnd.length);
        processMessage(completeMessage, host);
        messageBuffer = messageBuffer.slice(messageEndIndex + messageEnd.length);
      } else {
        break;
      }
    }
  };

  const processMessage = async (message: Buffer, host: string) => {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const parts = message.toString('utf-8').split(/[\0\n]+/);
    const equalsIndex = parts.findIndex((part) => part.startsWith('='));
    const licensePlate = parts[equalsIndex + 1];
    const uuid = parts[equalsIndex + 2];
    const colorNameIndex = parts.findIndex((part) => part.startsWith(`"ColorName`));
    const vehicleColor = parts[colorNameIndex].split('"')[3];
    const make = parts[colorNameIndex + 2].split('"')[3];
    const model = parts[colorNameIndex + 3].split('"')[3];
    const imagePath = `${OUTPUT_DIR}/${uuid}.jpg`;

    const imagePathParts = imagePath.split('/');
    const filename = imagePathParts[imagePathParts.length - 1];

    const hit: Hit = {
      uuid,
      systemId: host,
      timestamp,
      make,
      model,
      color: vehicleColor,
      licensePlateNumber: licensePlate,
      filename: filename,
    };

    const hitJson = JSON.stringify(hit, null, 2);
    console.log('\n' + hitJson);

    await csvWriter.writeRecords([hit]);
    console.log('Record written to CSV');
    extractJPEG(message, imagePath);
  };

  const extractJPEG = (message: Buffer, path: string) => {
    const jpegStartMarker = Buffer.from([0xFF, 0xD8]);
    const jpegEndMarker = Buffer.from([0xFF, 0xD9]);
    const jpegStartIndex = message.indexOf(jpegStartMarker);
    if (jpegStartIndex !== -1) {
      const jpegEndIndex = message.indexOf(jpegEndMarker, jpegStartIndex);
      if (jpegEndIndex !== -1) {
        const jpegData = message.slice(jpegStartIndex, jpegEndIndex + 2);
        fs.writeFileSync(path, jpegData);
        console.log('JPEG image extracted');
      }
    }
  };

  client.on('data', (data) => {
    handleData(data);
  });

  client.on('end', () => {
    console.log('Connection closed by the server.');
  });

  client.on('error', (err) => {
    console.error('Error occurred:', err);
  });

  client.on('timeout', () => {
    console.error('Connection timed out');
    client.end();
  });

  client.on('close', () => {
    console.log('Connection closed');
  });
});
