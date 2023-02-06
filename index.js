//Importing all needed Commands
const { Contract } = require("@ethersproject/contracts");
const { AlchemyProvider } = require("@ethersproject/providers");
const fs = require('fs');
const JSZip = require("jszip");
const { xBTCPlaceAddress, ensNameSolverKey, blockStep, blockTimeMS, alchemyKey, xBTCPlaceABI, latestBlockBackupFile, eventsBackupFile } = require("./config.js");

function appendFile(filePath, data) {
    return fs.appendFileSync(filePath, data);
}

function checkErr(err, exitOnError) {
    if (err !== undefined && err !== null) {
        console.log(err);
        if (exitOnError) {
            process.exit(-1);
        }
        return false;
    }
    return true;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const provider = new AlchemyProvider("matic", alchemyKey);
const ensSolver = new AlchemyProvider("mainnet", ensNameSolverKey);
const xBTCPlaceContract = new Contract(xBTCPlaceAddress, xBTCPlaceABI, provider);
const xBTCPlaceFilter = xBTCPlaceContract.filters.PixelsPlaced();

//last block synced
let syncBlock;

try {
    syncBlock = parseInt(fs.readFileSync(latestBlockBackupFile));
} catch (err) {
    checkErr(err, true);
}

function saveEvent(date, type, x, y, color) {
    try {
        appendFile(eventsBackupFile, "[" + date.getHours() + ":" + date.getMinutes() + "]" + "," + type + "," + x + "," + y + "," + color + "\n");
    } catch (err) {
        checkErr(err, true);
    }
}

//if un c'è il file
const rawdata = fs.readFileSync('map.json');
// const matrix = Array(500).fill(null).map(() => Array(500).fill({ color: 'FFFFFF', owner: '0x0', name: null }));
const matrix = new Array(500);

for (let i = 0; i < 500; i++) {
    const array = new Array(500);
    matrix[i] = array;
    for (let j = 0; j < 500; j++) {
        array[j] = { color: 'FFFFFF', owner: '0x0', name: null };
    }
    console.log("Matrix Population Progress: " + i / 500 * 100 + "% \r");
}

let map;

function buildMapFromMatrix() {
    const map = new Map();
    for (let i = 0; i < matrix.length; i++) {
        for (let j = 0; j < matrix[i].length; j++) {
            const item = matrix[i][j]; //{ color: pixel[2], owner: owner, name: value.name };
            const entry = map.get(item.owner);
            if (entry && entry.pixels) {
                const pixels = entry.pixels;
                // const newPixels = [...pixels];
                // newPixels.push([i, j, item.color])
                pixels.push([i, j, item.color]);
                // map.set(item.owner, { name: item.name, pixels: newPixels }) //owner=> {name: name, pixels: [x, y, color][]}
            } else {
                map.set(item.owner, { name: item.name, pixels: [[i, j, item.color]] }) //owner=> {name: name, pixels: [x, y, color][]}
            }
        }
        console.log("Build Map From Matrix Progress: " + i / 500 * 100 + "% \r");

    }
    return map;
}

function findPixel(x, y, pixels) {
    let i = 0;
    for (const pixel of pixels) {
        if (pixel[0] === x && pixel[1] === y) {
            return i;
        }
        i++;
    }
    return -1;
}

function updateData(x, y, newColor, newAddress, newName) {
    const oldData = matrix[x][y];
    console.log(oldData);
    const oldOwnerPixels = map.get(oldData.owner).pixels;
    const oldIndex = findPixel(x, y, oldOwnerPixels);
    console.log(oldIndex);
    oldOwnerPixels.splice(oldIndex, 1);
    map.set(oldData.owner, { name: oldData.name, pixels: oldOwnerPixels });

    const entry = map.get(newAddress);
    if (entry && entry.pixels) {
        const pixels = entry.pixels;
        const newPixels = [...pixels];
        newPixels.push([x, y, newColor])
        map.set(newAddress, { name: newName, pixels: newPixels }) //owner=> {name: name, pixels: [x, y, color][]}
    } else {
        map.set(newAddress, { name: newName, pixels: [[x, y, newColor]] }) //owner=> {name: name, pixels: [x, y, color][]}
    }

    matrix[x][y] = { color: newColor, owner: newAddress, name: newName };
}

if (rawdata.length > 0) {
    map = new Map(JSON.parse(rawdata));
    console.log("Done parsing");
    for (const [owner, value] of map) {
        for (const pixel of value.pixels) {
            matrix[pixel[0]][pixel[1]] = { color: pixel[2], owner: owner, name: value.name };
        }
    }
} else {
    map = buildMapFromMatrix();
    const stringifiedMap = JSON.stringify(Array.from(map.entries()));
    console.log("Done stringifying");
    fs.writeFileSync('map.json', stringifiedMap);
    console.log("Done writing map.json");
    const zipper = new JSZip();

    zipper.file('map.zip', stringifiedMap);
    zipper.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 9 } })
        .pipe(fs.createWriteStream('../website/build/map.zip'))
        .on('finish', function () {
            // JSZip generates a readable stream with a "end" event,
            // but is piped here in a writable stream which emits a "finish" event.
            console.log('Done writing map.zip');
        });
}


//altrimenti carico la mappa da file e mi creo anche la matrice

const watch = async () => {
    while (1) {
        const date = new Date();
        const latestBlock = await provider.getBlockNumber();

        if (syncBlock < latestBlock) {
            console.log("[" + date.getHours() + ":" + date.getMinutes() + "] Syncing at block " + syncBlock + "/" + latestBlock);

            //dont ask for non existing blocks
            let nextSyncBlock = syncBlock + blockStep
            if (nextSyncBlock > latestBlock) {
                nextSyncBlock = latestBlock;
            }

            let placeEvents = await xBTCPlaceContract.queryFilter(xBTCPlaceFilter, syncBlock, nextSyncBlock);

            for (const event of placeEvents) {
                if (event.event == "PixelsPlaced") {

                    const xArr = event.args.x;
                    const yArr = event.args.y;
                    const colorArr = event.args.color;
                    const address = (await event.getTransactionReceipt()).from;
                    const name = await ensSolver.lookupAddress(address).catch((e) => console.log(e));

                    for (let i = 0; i < xArr.length; i++) {
                        const x = parseInt(xArr[i]);
                        const y = parseInt(yArr[i]);
                        const color = parseInt(colorArr[i]).toString(16).toUpperCase().padStart(6, 0);
                        updateData(x, y, color, address, name);
                        saveEvent(date, "Place", x, y, "#" + color);
                    }

                    const stringifiedMap = JSON.stringify(Array.from(map.entries()));
                    fs.writeFileSync('map.json', stringifiedMap);
                    const zipper = new JSZip();
                    zipper.file('map.zip', stringifiedMap);
                    zipper.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 9 } })
                        .pipe(fs.createWriteStream('../website/build/map.zip'))
                        .on('finish', function () {
                            // JSZip generates a readable stream with a "end" event,
                            // but is piped here in a writable stream which emits a "finish" event.
                            console.log('map.zip written.');
                        });

                }
            }

            syncBlock = nextSyncBlock + 1;
            console.log("[" + date.getHours() + ":" + date.getMinutes() + "] Saving (#" + syncBlock + ") to " + latestBlockBackupFile);
            fs.writeFileSync(latestBlockBackupFile, syncBlock.toString());

            //chill for a while, don't want to make alchemy mad
            await sleep(500);
        } else {
            console.log("[" + date.getHours() + ":" + date.getMinutes() + "] Sync done (#" + latestBlock + "), waiting for new blocks");

            //saving
            fs.writeFileSync(latestBlockBackupFile, syncBlock.toString());

            console.log("[" + date.getHours() + ":" + date.getMinutes() + "] Sync status saved");

            //wait till hopefully enough blocks are mined
            await sleep(blockStep * blockTimeMS);
        }
    }
};

watch();



