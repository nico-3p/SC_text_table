const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const glob = require('glob');
const { mkdirp } = require('mkdirp');
const Axios = require('axios');
const { createHash } = require('crypto');
const { createGunzip } = require('zlib');
const concatStream = require('concat-stream');
const ffmpeg = require('fluent-ffmpeg');

let win;

const createWindow = () => {
    win = new BrowserWindow({
        width: 1200,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'packages/main/preload.cjs'),
        },
    });
    // win.webContents.openDevTools();

    win.loadFile('packages/renderer/index.html');

    ipcMain.on('getAssets', async (event, filterStr, getCount, shouldDownloadAssetMap) => {
        getAssetsMain(filterStr, getCount, shouldDownloadAssetMap);
    });

    ipcMain.on('createJSON', async (event) => {
        createJSON();
    });

    ipcMain.on('downloadAudio', async (event, src, name) => {
        downloadAudio(src, name);
    });
};

app.whenReady().then(() => {
    ipcMain.handle('loadJSON', loadJSON);

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

//----

const axios = Axios.create({
    baseURL: `https://${atob('c2hpbnljb2xvcnMuZW56YS5mdW4=')}/assets/`,
    responseType: 'arraybuffer',
});

const getAssetsMain = async (filterStr, getCount, shouldDownloadAssetMap) => {
    await mkdirp('assets');

    let allAssets = {};
    if (shouldDownloadAssetMap) {
        const assetMapChunks = await getAssetMap();
        allAssets = await getAssetMapChunks(assetMapChunks, getCount);
    } else {
        allAssets = await loadAssetMap(getCount);
    }

    await getAsset(allAssets, filterStr);

    win.webContents.send('sendLog', 'end getAsset');
};

const loadAssetMap = async (slice = 0) => {
    const basePath = './assets';

    const files = await fs.promises.readdir(basePath);
    let chunkPaths = files.filter(function (file) {
        return fs.statSync(path.join(basePath, file)).isFile() && /^asset-map-chunk/.test(file); //絞り込み
    });
    chunkPaths.sort((a, b) => {
        const aNum = parseInt(a.match(/(\d+)/)[0]);
        const bNum = parseInt(b.match(/(\d+)/)[0]);
        return aNum - bNum;
    });

    if (slice != 0) {
        chunkPaths = chunkPaths.slice(-slice);
    }

    const assets = {};

    for (const chunkPath of chunkPaths) {
        const chankValue = JSON.parse(fs.readFileSync(path.join(basePath, chunkPath), 'utf8'));
        Object.assign(assets, chankValue);
    }

    return assets;
};

const getAssetMap = async () => {
    const assetMapHash = encryptPath('asset-map.json');
    const { data: assetMapBuffer } = await axios.get(`asset-map-${assetMapHash}`);
    const assetMap = JSON.parse((await decryptResource(assetMapBuffer)).toString());
    const chunks = assetMap.chunks;

    await fs.writeFile(`./assets/asset-map.json`, JSON.stringify(assetMap, null, '  '));

    return chunks;
};

const getAssetMapChunks = async (chunks, slice = 0) => {
    if (slice != 0) {
        chunks = chunks.slice(-slice);
    }

    const assets = {};
    for (let i = 0; i < chunks.length; i++) {
        const mes = `[getAssetMapChunks] ${i} / ${chunks.length} - ${Math.floor((i / chunks.length) * 100)}%`;
        console.log(mes);
        win.webContents.send('sendLog', mes);

        const chunk = chunks[i];
        for (const [assetPath, version] of Object.entries(chunk)) {
            const ret = await downloadAsset(assetPath, version);
            Object.assign(assets, ret);
        }
    }

    return assets;
};

const getAsset = async (assets, filter = '.*') => {
    const filter_re = new RegExp(filter);

    const assetsArr = Object.entries(assets).filter(([assetPath, _]) => filter_re.test(assetPath));

    for (let i = 0; i < assetsArr.length; i++) {
        const [assetPath, version] = assetsArr[i];

        const mes = `[getAsset] ${i} / ${assetsArr.length} - ${Math.floor((i / assetsArr.length) * 100)}%`;
        console.log(mes);
        win.webContents.send('sendLog', mes);

        await downloadAsset(assetPath, version);
    }
};
const downloadAsset = async (assetPath, v) => {
    const localPath = path.join('assets', assetPath);
    await mkdirp(path.dirname(localPath));

    if (!assetPath.startsWith('asset-map') && (await fs.pathExists(localPath))) {
        console.log(`Skippig ${assetPath}...`);
        return;
    }

    const hash = encryptPath(assetPath);
    const assetExtname = path.extname(assetPath);
    const extname = assetExtname === '.mp4' || assetExtname === '.m4a' ? assetExtname : '';

    console.log(`Downloading ${assetPath} (hash = ${hash})...`);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const { data, headers } = await axios.get(`${hash}${extname}?v=${v}`);
    const contentType = headers['content-type'] || '';

    if (contentType.startsWith('text/') && contentType !== 'text/html') {
        const plainData = await decryptResource(data);
        try {
            const dataObj = JSON.parse(plainData.toString());
            await fs.writeFile(localPath, JSON.stringify(dataObj, null, '  '));
            return dataObj;
        } catch (e) {
            console.log(e);

            await fs.writeFile(localPath, plainData);
            return plainData;
        }
    }

    await fs.writeFile(localPath, data);
    return data;
};

const decryptResource = async (data) => {
    const keyHex = '42274b59574c5b44495c7671554979775f77655f6172655f686972696e675f68747470733a2f2f6b6e6f636b6e6f74652e636f2e6a70';
    const key = Buffer.from(keyHex, 'hex');

    for (const [i] of data.entries()) {
        data[i] ^= key[i % key.length];
    }
    const gunzip = createGunzip();
    const res = await new Promise((resolve) => {
        const concatter = concatStream({ encoding: 'buffer' }, resolve);
        gunzip.pipe(concatter);
        gunzip.on('error', () => {
            concatter.end();
        });
        gunzip.end(data);
    });
    return res;
};

const encryptPath = (assetPath) => {
    const basename = path.basename(assetPath, path.extname(assetPath));
    const key = `${basename[0]}${basename[basename.length - 1]}/assets/${assetPath}`;
    return createHash('sha256').update(key, 'utf-8').digest('hex');
};

// ----

const shapData = (x) => {
    const asset_path = 'sounds/voice/events/' + x['voice'] + '.m4a';
    const hash = encryptPath(asset_path);
    const encryptedPath = `https://shinycolors.enza.fun/assets/${hash}.m4a`;

    if (!'id' in x) x['id'] = '';
    if (!'speaker' in x) x['speaker'] = '';
    if (!'text' in x) x['text'] = '';

    return {
        id: x['id'],
        speaker: x['speaker'],
        text: x['text'],
        audio: encryptedPath,
    };
};

const formatData = async (filePath, resultData) => {
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));

    const filteredData = data.filter((e) => 'voice' in e && 'text' in e && 'speaker' in e);
    // const shapedData = filteredData.map(e => shapData(e)).map(e => e['json'] = filePath);
    const shapedData = filteredData.map((e) => shapData(e));

    for (e of shapedData) {
        e['json'] = filePath;
    }

    return shapedData;
};

const createJSON = async () => {
    let files = glob.sync('assets/json/**/*.json');
    let resultData = [];

    // files = files.slice(-12);

    for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        const progress = Math.floor((i / files.length) * 100);
        let message = `createJSON - [${progress}%] ${filePath}`;
        console.log(message);
        win.webContents.send('sendLog', message);
        resultData = resultData.concat(await formatData(filePath));
    }

    fs.writeFile('./assets/voice.json', JSON.stringify(resultData));

    let message = `createJSON - end`;
    console.log(message);
    win.webContents.send('sendLog', message);
};

// ----

const loadJSON = async () => {
    const data = JSON.parse(fs.readFileSync('./assets/voice.json', 'utf8'));
    return data;
};

// ----

const fixPathName = (name) => {
    let marks = ['\n', '\r'];
    for (let mark of marks) {
        name = name.replace(mark, '');
    }

    marks = ['\\', '/', ':', '*', '?', 'a', '<', '>', '|'];
    for (let mark of marks) {
        name = name.replace(mark, '_');
    }

    return name;
};

const encodeWav = (inPath, outPath) => {
    return new Promise((resolve, reject) => {
        console.log(inPath);
        console.log(outPath);

        ffmpeg(inPath)
            .format('wav')
            .audioFrequency(44100)
            .on('end', function (stdout, stderr) {
                console.log('Transcoding succeeded !');
                resolve();
            })
            .on('error', function (err, stdout, stderr) {
                console.log('Cannot process video: ' + err.message);
                reject();
            })
            .save(outPath);
    });
};

const downloadAudio = async (src, name) => {
    name = fixPathName(name);

    const assetExtname = path.extname(src);

    const voiceDir = 'voice';
    const localPath = path.join(voiceDir, name + assetExtname);
    await mkdirp(path.dirname(localPath));

    const { data } = await axios.get(`${src}`);
    await fs.writeFile(localPath, data);

    const encodePath = path.join(voiceDir, name + '.wav');
    await encodeWav(localPath, encodePath);

    fs.unlinkSync(localPath);
};
