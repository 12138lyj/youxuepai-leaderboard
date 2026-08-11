(function exposeCloud(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LeaderboardCloud = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  'use strict';

  function createCloudSync({
    client,
    editorEmail,
    recordId = 'main',
    normalize,
    onStatus = () => {},
    onRemote = () => {},
    debounceMs = 400,
    now = () => Date.now(),
  }) {
    let revision = 0;
    let pendingPayload = null;
    let saveTimer = null;
    let channel = null;
    let authSubscription = null;

    async function load() {
      onStatus('connecting');
      const { data, error } = await client
        .from('leaderboard_state')
        .select('payload,revision,updated_at')
        .eq('id', recordId)
        .single();
      if (error) {
        onStatus('offline');
        throw error;
      }
      revision = Number(data.revision) || 0;
      onStatus('synced');
      return { ...data, revision, payload: normalize(data.payload) };
    }

    async function listHistory() {
      const { data, error } = await client
        .from('leaderboard_state_history')
        .select('id,state_id,revision,payload,created_at')
        .eq('state_id', recordId)
        .order('revision', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []).map((row) => ({
        ...row,
        id: Number(row.id),
        revision: Number(row.revision),
        payload: normalize(row.payload),
      }));
    }

    async function signIn(password) {
      const result = await client.auth.signInWithPassword({ email: editorEmail, password });
      if (result.error) throw result.error;
      return result.data.session;
    }

    async function isAuthenticated() {
      const { data } = await client.auth.getSession();
      return Boolean(data.session);
    }

    async function signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    }

    async function uploadRankupAudio(file) {
      const fileName = String(file?.name || 'rankup-audio.mp3');
      const extension = fileName.includes('.')
        ? fileName.split('.').pop().toLowerCase()
        : 'mp3';
      const baseName = fileName.replace(/\.[^.]+$/, '')
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'rankup-audio';
      const path = `main/${now()}-${baseName}.${extension}`;
      const bucket = client.storage.from('rankup-audio');
      const { error } = await bucket.upload(path, file, {
        cacheControl: '3600',
        contentType: file?.type,
        upsert: false,
      });
      if (error) throw error;
      const { data } = bucket.getPublicUrl(path);
      if (!data?.publicUrl) throw new Error('无法获取音频公开网址');
      return { path, url: data.publicUrl };
    }

    async function removeRankupAudio(path) {
      const normalizedPath = String(path || '');
      if (!/^main\/[a-zA-Z0-9._-]+$/.test(normalizedPath)) return false;
      const { error } = await client.storage.from('rankup-audio').remove([normalizedPath]);
      if (error) throw error;
      return true;
    }

    async function flush() {
      clearTimeout(saveTimer);
      saveTimer = null;
      if (!pendingPayload) return null;
      const payload = pendingPayload;
      onStatus('saving');
      const { data, error } = await client
        .rpc('save_leaderboard_state', { p_payload: payload })
        .single();
      if (error) {
        onStatus('failed');
        throw error;
      }
      if (pendingPayload === payload) pendingPayload = null;
      revision = Number(data.revision) || revision;
      onStatus('synced');
      return { ...data, revision, payload: normalize(data.payload) };
    }

    async function restoreSnapshot(snapshotId) {
      const id = Number(snapshotId);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('无效的历史版本');
      await flush();
      onStatus('saving');
      const { data, error } = await client
        .rpc('restore_leaderboard_snapshot', { p_snapshot_id: id })
        .single();
      if (error) {
        onStatus('failed');
        throw error;
      }
      pendingPayload = null;
      revision = Number(data.revision) || revision;
      onStatus('synced');
      return { ...data, revision, payload: normalize(data.payload) };
    }

    function queueSave(payload) {
      pendingPayload = normalize(payload);
      onStatus('saving');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void flush().catch(() => {}), debounceMs);
    }

    function subscribe() {
      channel = client
        .channel('leaderboard-main')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'leaderboard_state',
            filter: `id=eq.${recordId}`,
          },
          (event) => {
            const nextRevision = Number(event.new.revision) || 0;
            if (nextRevision <= revision) return;
            revision = nextRevision;
            onRemote({ payload: normalize(event.new.payload), revision });
          },
        )
        .subscribe();
      return channel;
    }

    function onAuthChange(callback) {
      const { data } = client.auth.onAuthStateChange((event) => callback(event));
      authSubscription = data.subscription;
      return authSubscription;
    }

    async function destroy() {
      clearTimeout(saveTimer);
      if (channel) await client.removeChannel(channel);
      if (authSubscription) authSubscription.unsubscribe();
      channel = null;
      authSubscription = null;
    }

    return {
      load,
      listHistory,
      signIn,
      isAuthenticated,
      signOut,
      uploadRankupAudio,
      removeRankupAudio,
      flush,
      restoreSnapshot,
      queueSave,
      subscribe,
      onAuthChange,
      destroy,
      getPendingPayload: () => pendingPayload,
      getRevision: () => revision,
    };
  }

  return { createCloudSync };
});
