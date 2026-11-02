(function (global) {
  const DB_NAME = 'qi-shared-tracker-folders';
  const STORE_NAME = 'handles';
  const POLL_INTERVAL_MS = 3000;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getSavedHandle(key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveHandle(key, handle) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(handle, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function serialize(value) {
    return JSON.stringify(value);
  }

  global.createSharedJsonSync = function (options) {
    const button = document.getElementById(options.buttonId);
    const status = document.getElementById(options.statusId);
    const migrationKey = `shared_json_migrated_${options.appKey}`;
    const baselineKey = `shared_json_baseline_${options.appKey}`;
    let directoryHandle = null;
    let connected = false;
    let busy = false;
    let pollTimer = null;
    let lastLocalText = '';
    let lastRemoteText = '';

    function setStatus(message, isError) {
      if (!status) return;
      status.textContent = message;
      status.classList.toggle('sync-error', !!isError);
    }

    function localData() {
      return options.getData();
    }

    async function ensurePermission(handle, request) {
      const permission = { mode: 'readwrite' };
      if (await handle.queryPermission(permission) === 'granted') return true;
      return request && await handle.requestPermission(permission) === 'granted';
    }

    async function readRemoteData() {
      const fileHandle = await directoryHandle.getFileHandle(options.fileName, { create: true });
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (!text.trim()) return { text: '', data: null };
      const record = JSON.parse(text);
      if (record.version !== 1 || !record.data || !options.isValid(record.data)) {
        throw new Error(`${options.fileName} has an unsupported format.`);
      }
      return { text, data: record.data };
    }

    async function writeRemoteData(data) {
      const fileHandle = await directoryHandle.getFileHandle(options.fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), data }, null, 2));
      await writable.close();
    }

    function updateConnectedStatus() {
      setStatus(`Connected to Google Drive folder "${directoryHandle.name}". Updates sync while this page is open.`, false);
      if (button) button.textContent = 'Reconnect Shared Folder';
    }

    function saveBaseline(local, remoteText) {
      lastLocalText = serialize(local);
      lastRemoteText = remoteText;
      localStorage.setItem(migrationKey, 'true');
      localStorage.setItem(baselineKey, lastLocalText);
    }

    async function connect(handle, requestPermission) {
      directoryHandle = handle;
      if (!await ensurePermission(handle, requestPermission)) {
        connected = false;
        setStatus('Read/write folder permission is required. Reconnect and allow access.', true);
        return;
      }

      const remote = await readRemoteData();
      const local = localData();
      const migrated = localStorage.getItem(migrationKey) === 'true';
      const baseline = localStorage.getItem(baselineKey);
      const hasLocalData = !options.hasLocalData || options.hasLocalData(local);
      const localChanged = migrated ? baseline === null || serialize(local) !== baseline : hasLocalData;
      const data = remote.data
        ? localChanged ? options.mergeData(remote.data, local) : remote.data
        : local;

      await options.setData(data);
      await writeRemoteData(data);
      saveBaseline(localData(), serialize(data));
      connected = true;
      clearInterval(pollTimer);
      pollTimer = setInterval(syncOnce, POLL_INTERVAL_MS);
      updateConnectedStatus();
    }

    async function syncOnce() {
      if (!connected || busy) return;
      busy = true;
      try {
        if (!await ensurePermission(directoryHandle, false)) {
          connected = false;
          clearInterval(pollTimer);
          setStatus('Google Drive permission expired. Reconnect the shared folder.', true);
          return;
        }

        const remote = await readRemoteData();
        const local = localData();
        const localText = serialize(local);
        const remoteText = remote.data ? serialize(remote.data) : '';
        const localChanged = localText !== lastLocalText;
        const remoteChanged = remoteText !== lastRemoteText;
        if (!localChanged && !remoteChanged) return;

        if (remote.data && remoteChanged && !localChanged) {
          await options.setData(remote.data);
          saveBaseline(localData(), remoteText);
          setStatus('Updated from the shared Google Drive file.', false);
          return;
        }

        const merged = remote.data ? options.mergeData(remote.data, local) : local;
        await options.setData(merged);
        await writeRemoteData(merged);
        saveBaseline(localData(), serialize(merged));
        updateConnectedStatus();
      } catch (error) {
        setStatus(error.message || 'Shared-file sync failed. Check folder access and try again.', true);
      } finally {
        busy = false;
      }
    }

    async function chooseFolder() {
      if (!('showDirectoryPicker' in global)) {
        setStatus('Use Chrome or Edge to connect a Google Drive for desktop folder.', true);
        return;
      }
      try {
        const handle = await global.showDirectoryPicker({ id: `qi-shared-${options.appKey}`, mode: 'readwrite' });
        await saveHandle(options.appKey, handle);
        await connect(handle, true);
      } catch (error) {
        if (error.name !== 'AbortError') setStatus(error.message || 'Could not connect the Google Drive folder.', true);
      }
    }

    async function start() {
      try {
        const handle = await getSavedHandle(options.appKey);
        if (!handle) return;
        directoryHandle = handle;
        if (await ensurePermission(handle, false)) await connect(handle, false);
        else setStatus('Previously selected Google Drive folder needs permission. Reconnect it to continue.', false);
      } catch (error) {
        setStatus(error.message || 'Could not restore the shared folder.', true);
      }
    }

    function disconnect() {
      connected = false;
      clearInterval(pollTimer);
      pollTimer = null;
    }

    if (button) button.addEventListener('click', chooseFolder);
    global.addEventListener('beforeunload', disconnect);

    return { start, connect: chooseFolder, connectHandle: handle => connect(handle, true), disconnect, sync: syncOnce };
  };
})(window);
