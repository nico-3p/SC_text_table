const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getAssets: (filterStr, getCount, shouldDownloadAssetMap) => ipcRenderer.send('getAssets', filterStr, getCount, shouldDownloadAssetMap),
    createJSON: () => ipcRenderer.send('createJSON'),
    loadJSON: () => ipcRenderer.invoke('loadJSON'),

    downloadAudio: (src, name) => ipcRenderer.send('downloadAudio', src, name),

    onGetLog: (callback) => ipcRenderer.on('sendLog', callback),
});
