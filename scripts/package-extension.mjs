import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const packageDir = join(repoRoot, "dist", pkg.name);
const zipPath = join(repoRoot, "dist", `${pkg.name}-${pkg.version}.zip`);
const crcTable = createCrcTable();
const args = new Set(process.argv.slice(2));

const staticFiles = [
  "manifest.json",
  "icons/icon16.svg",
  "icons/icon48.svg",
  "icons/icon128.svg",
  "src/editor-bridge.js",
  "src/styles.css",
];
const packageFiles = [...staticFiles, "src/content.js"];

if (args.size === 0 || args.has("--stage")) {
  stagePackageDirectory();
}

if (args.size === 0 || args.has("--zip")) {
  writeZipPackage();
}

function stagePackageDirectory() {
  rmSync(packageDir, { recursive: true, force: true });
  rmSync(zipPath, { force: true });
  mkdirSync(packageDir, { recursive: true });

  for (const file of staticFiles) {
    const dest = join(packageDir, file);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(repoRoot, file), dest);
  }

  console.log(`Staged extension directory: dist/${pkg.name}`);
}

function writeZipPackage() {
  const missing = packageFiles.filter((file) => !existsSync(join(packageDir, file)));
  if (missing.length > 0) {
    throw new Error(`Cannot package extension; missing files: ${missing.join(", ")}`);
  }

  writeFileSync(zipPath, createZip(packageFiles.map((file) => ({
    name: file.replaceAll("\\", "/"),
    data: readFileSync(join(packageDir, file)),
  }))));

  console.log(`Packaged extension zip: dist/${pkg.name}-${pkg.version}.zip`);
}

function createZip(entries) {
  const fileRecords = [];
  const centralRecords = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const { time, date } = dosDateTime(new Date());

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    fileRecords.push(local, data);
    centralRecords.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centralRecords.reduce((sum, record) => sum + record.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...fileRecords, ...centralRecords, end]);
}

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
