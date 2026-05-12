const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  selectPretalkFile: () => ipcRenderer.invoke('select-pretalk-file'),
  saveDocxReport: (payload) => ipcRenderer.invoke('save-docx-report', payload)
});
