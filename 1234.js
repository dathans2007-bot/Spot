(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const DB_NAME = 'offline-beats-db-v2';
  const DB_VERSION = 1;
  let db = null;
  let tracks = [];
  let playlists = [];
  let currentTrackId = null;
  let currentQueue = [];
  let shuffle = false;
  let repeat = false;
  let activePlaylistId = null;
  let toastTimer = null;
  const audio = $('audio');

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('This browser does not support local music storage.'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('tracks')) database.createObjectStore('tracks', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('playlists')) database.createObjectStore('playlists', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open music storage.'));
    });
  }
  function store(name, mode='readonly') { return db.transaction(name, mode).objectStore(name); }
  function getAll(name) {
    return new Promise((resolve, reject) => {
      const req = store(name).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  function put(name, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite');
      tx.objectStore(name).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  function remove(name, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite');
      tx.objectStore(name).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  function uid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmt(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const s = Math.floor(seconds);
    return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0');
  }
  function titleFromName(name) { return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Unknown track'; }
  function notify(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }
  function showPage(name) {
    const valid = ['home','library','playlists','liked'].includes(name) ? name : 'home';
    document.querySelectorAll('[data-page-section]').forEach(section => section.classList.toggle('active', section.dataset.pageSection === valid));
    document.querySelectorAll('.nav-item[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === valid));
    if (valid === 'playlists') renderPlaylists();
    if (valid === 'library') renderLibrary();
    if (valid === 'liked') renderLiked();
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function trackById(id) { return tracks.find(t => t.id === id); }
  function activeTrack() { return trackById(currentTrackId); }
  function trackRow(track, options={}) {
    const liked = !!track.liked;
    const subtitle = track.artist || 'Unknown artist';
    const removeFromPlaylist = options.playlistId ? `<button class="mini-button remove-playlist" data-track-id="${esc(track.id)}" data-playlist-id="${esc(options.playlistId)}" aria-label="Remove from playlist" title="Remove from playlist">−</button>` : '';
    return `<div class="track-row">
      <button class="track-art play-track" data-track-id="${esc(track.id)}" aria-label="Play ${esc(track.title)}">♫</button>
      <div class="track-meta play-track" data-track-id="${esc(track.id)}" role="button" tabindex="0"><div class="track-title">${esc(track.title)}</div><div class="track-subtitle">${esc(subtitle)}</div></div>
      <div class="track-actions"><button class="mini-button ${liked?'liked':''} like-track" data-track-id="${esc(track.id)}" aria-label="${liked?'Unlike':'Like'} song">${liked?'♥':'♡'}</button>${removeFromPlaylist}<button class="mini-button play-mini play-track" data-track-id="${esc(track.id)}" aria-label="Play song">▶</button></div>
    </div>`;
  }
  function renderHome() {
    const recent = [...tracks].sort((a,b)=>(b.addedAt||0)-(a.addedAt||0)).slice(0,5);
    $('homeRecent').innerHTML = recent.map(t=>trackRow(t)).join('');
    $('homeEmpty').classList.toggle('hidden', tracks.length > 0);
    $('homeRecent').classList.toggle('hidden', tracks.length === 0);
  }
  function renderLibrary() {
    const query = $('searchInput').value.trim().toLowerCase();
    const filtered = [...tracks].sort((a,b)=>a.title.localeCompare(b.title)).filter(t => (t.title+' '+(t.artist||'')).toLowerCase().includes(query));
    $('libraryTracks').innerHTML = filtered.map(t=>trackRow(t)).join('');
    $('libraryEmpty').classList.toggle('hidden', tracks.length > 0);
    $('libraryTracks').classList.toggle('hidden', filtered.length === 0 || tracks.length === 0);
    $('searchEmpty').classList.toggle('hidden', !query || filtered.length > 0);
  }
  function renderLiked() {
    const liked = tracks.filter(t=>t.liked);
    $('likedTracks').innerHTML = liked.map(t=>trackRow(t)).join('');
    $('likedEmpty').classList.toggle('hidden', liked.length > 0);
    $('likedTracks').classList.toggle('hidden', liked.length === 0);
  }
  function renderPlaylists() {
    $('playlistList').innerHTML = playlists.map(p=>`<button class="playlist-card open-playlist" data-playlist-id="${esc(p.id)}"><span class="playlist-symbol">▧</span><strong>${esc(p.name)}</strong><small>${p.trackIds.length} ${p.trackIds.length===1?'song':'songs'}</small></button>`).join('');
    const detailOpen = !!activePlaylistId && playlists.some(p=>p.id===activePlaylistId);
    $('playlistEmpty').classList.toggle('hidden', playlists.length > 0 || detailOpen);
    $('playlistList').classList.toggle('hidden', detailOpen || playlists.length===0);
    $('playlistDetail').classList.toggle('hidden', !detailOpen);
    if (!detailOpen) return;
    const playlist = playlists.find(p=>p.id===activePlaylistId);
    $('detailTitle').textContent = playlist.name;
    $('detailCount').textContent = `${playlist.trackIds.length} ${playlist.trackIds.length===1?'song':'songs'}`;
    $('detailTracks').innerHTML = playlist.trackIds.map(id=>trackById(id)).filter(Boolean).map(t=>trackRow(t,{playlistId:playlist.id})).join('');
    const available = tracks.filter(t=>!playlist.trackIds.includes(t.id));
    $('addTrackSelect').innerHTML = available.length ? available.map(t=>`<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('') : '<option value="">All songs are already added</option>';
    $('addTrackButton').disabled = available.length===0;
  }
  function renderAll() { renderHome(); renderLibrary(); renderLiked(); renderPlaylists(); updatePlayerUI(); }
  async function reload() {
    tracks = await getAll('tracks');
    playlists = await getAll('playlists');
    renderAll();
  }
  async function importFiles(fileList) {
    const files = [...fileList].filter(file => file.type.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|aac|flac|opus|aiff?)$/i.test(file.name));
    if (!files.length) { notify('Choose one or more audio files.'); return; }
    let added = 0;
    for (const file of files) {
      const track = {id:uid(), title:titleFromName(file.name), artist:'', fileName:file.name, mimeType:file.type || 'audio/mpeg', blob:file, liked:false, addedAt:Date.now()+added};
      try { await put('tracks', track); added++; } catch (error) { console.error(error); }
    }
    await reload();
    $('filePicker').value = '';
    notify(added ? `${added} song${added===1?'':'s'} added to your library` : 'Could not save these files. Check device storage.');
    showPage('library');
  }
  async function playTrack(id, queue) {
    const track = trackById(id);
    if (!track) { notify('That song is no longer in your library.'); return; }
    if (queue && queue.length) currentQueue = queue.slice();
    else if (!currentQueue.includes(id)) currentQueue = tracks.map(t=>t.id);
    currentTrackId = id;
    if (audio.dataset.trackId !== id) {
      if (audio.dataset.objectUrl) URL.revokeObjectURL(audio.dataset.objectUrl);
      const url = URL.createObjectURL(track.blob);
      audio.src = url;
      audio.dataset.objectUrl = url;
      audio.dataset.trackId = id;
    }
    $('nowTitle').textContent = track.title;
    $('nowArtist').textContent = track.artist || track.fileName || 'Local audio';
    $('playPause').textContent = '❚❚';
    $('playerLike').textContent = track.liked ? '♥' : '♡';
    $('playerLike').classList.toggle('liked', !!track.liked);
    try { await audio.play(); } catch (error) { $('playPause').textContent='▶'; notify('Tap play to start audio on this device.'); }
  }
  async function toggleLike(id) {
    const track = trackById(id);
    if (!track) return;
    track.liked = !track.liked;
    await put('tracks', track);
    renderAll();
  }
  async function moveTrack(direction) {
    if (!currentQueue.length) currentQueue = tracks.map(t=>t.id);
    if (!currentQueue.length) { notify('Add music first.'); return; }
    let index = currentQueue.indexOf(currentTrackId);
    if (shuffle && currentQueue.length > 1) {
      let next = index;
      while (next === index) next = Math.floor(Math.random()*currentQueue.length);
      await playTrack(currentQueue[next]);
    } else {
      index = (index + direction + currentQueue.length) % currentQueue.length;
      await playTrack(currentQueue[index]);
    }
  }
  function updatePlayerUI() {
    const t = activeTrack();
    $('playerLike').textContent = t && t.liked ? '♥' : '♡';
    $('playerLike').classList.toggle('liked', !!(t && t.liked));
    $('shuffleButton').classList.toggle('enabled', shuffle);
    $('repeatButton').classList.toggle('enabled', repeat);
    if (!t && !audio.src) {
      $('nowTitle').textContent = 'Nothing playing';
      $('nowArtist').textContent = 'Choose a song from your library';
    }
  }
  function renderCurrentTrackState() {
    const t = activeTrack();
    $('playerLike').textContent = t && t.liked ? '♥' : '♡';
    $('playerLike').classList.toggle('liked', !!(t && t.liked));
  }

  document.addEventListener('click', async event => {
    const pageButton = event.target.closest('[data-page]');
    if (pageButton) { event.preventDefault(); showPage(pageButton.dataset.page); return; }
    const importButton = event.target.closest('[data-action="import"], #importTop');
    if (importButton) { $('filePicker').click(); return; }
    const playButton = event.target.closest('.play-track');
    if (playButton) {
      const id = playButton.dataset.trackId;
      const row = playButton.closest('.track-list');
      const ids = row ? [...row.querySelectorAll('.play-track[data-track-id]')].map(el=>el.dataset.trackId) : tracks.map(t=>t.id);
      const queue = [...new Set(ids)];
      await playTrack(id, queue);
      return;
    }
    const likeButton = event.target.closest('.like-track');
    if (likeButton) { await toggleLike(likeButton.dataset.trackId); return; }
    const openPlaylist = event.target.closest('.open-playlist');
    if (openPlaylist) { activePlaylistId=openPlaylist.dataset.playlistId; renderPlaylists(); return; }
    const removeButton = event.target.closest('.remove-playlist');
    if (removeButton) {
      const playlist=playlists.find(p=>p.id===removeButton.dataset.playlistId);
      if (playlist) { playlist.trackIds=playlist.trackIds.filter(id=>id!==removeButton.dataset.trackId); await put('playlists',playlist); await reload(); }
    }
  });
  document.addEventListener('keydown', event => {
    if (event.target.matches('.play-track[role="button"]') && (event.key==='Enter'||event.key===' ')) { event.preventDefault(); event.target.click(); }
  });
  $('filePicker').addEventListener('change', event => importFiles(event.target.files));
  $('searchInput').addEventListener('input', renderLibrary);
  $('createPlaylist').addEventListener('click', async () => {
    const name=$('playlistName').value.trim();
    if (!name) { notify('Give your playlist a name first.'); $('playlistName').focus(); return; }
    const playlist={id:uid(),name,trackIds:[],createdAt:Date.now()};
    await put('playlists',playlist);
    $('playlistName').value='';
    await reload();
    activePlaylistId=playlist.id;
    renderPlaylists();
    notify('Playlist created');
  });
  $('playlistName').addEventListener('keydown', event => { if(event.key==='Enter') $('createPlaylist').click(); });
  $('backPlaylists').addEventListener('click',()=>{activePlaylistId=null;renderPlaylists();});
  $('deletePlaylist').addEventListener('click', async()=>{
    const p=playlists.find(x=>x.id===activePlaylistId);
    if(!p)return;
    if(!confirm(`Delete playlist "${p.name}"? Your music files will stay in the library.`))return;
    await remove('playlists',p.id);activePlaylistId=null;await reload();notify('Playlist deleted');
  });
  $('addTrackButton').addEventListener('click',async()=>{
    const p=playlists.find(x=>x.id===activePlaylistId), id=$('addTrackSelect').value;
    if(!p||!id)return;
    if(!p.trackIds.includes(id))p.trackIds.push(id);
    await put('playlists',p);await reload();notify('Song added to playlist');
  });
  $('playPause').addEventListener('click',async()=>{
    if(!audio.src){const first=tracks[0];if(first)await playTrack(first.id);else notify('Add music first.');return;}
    if(audio.paused){try{await audio.play();}catch(e){notify('Could not play this audio file.');}}else audio.pause();
  });
  $('previousButton').addEventListener('click',()=>moveTrack(-1));
  $('nextButton').addEventListener('click',()=>moveTrack(1));
  $('skipBack').addEventListener('click',()=>{audio.currentTime=Math.max(0,audio.currentTime-10);});
  $('skipForward').addEventListener('click',()=>{if(Number.isFinite(audio.duration))audio.currentTime=Math.min(audio.duration,audio.currentTime+10);});
  $('shuffleButton').addEventListener('click',()=>{shuffle=!shuffle;updatePlayerUI();notify(shuffle?'Shuffle on':'Shuffle off');});
  $('repeatButton').addEventListener('click',()=>{repeat=!repeat;audio.loop=repeat;updatePlayerUI();notify(repeat?'Repeat song on':'Repeat off');});
  $('speedSelect').addEventListener('change',()=>{audio.playbackRate=Number($('speedSelect').value);});
  $('playerLike').addEventListener('click',async()=>{if(currentTrackId)await toggleLike(currentTrackId);else notify('Play a song first.');});
  $('seekBar').addEventListener('input',()=>{if(Number.isFinite(audio.duration)&&audio.duration>0)audio.currentTime=(Number($('seekBar').value)/1000)*audio.duration;});
  audio.addEventListener('play',()=>$('playPause').textContent='❚❚');
  audio.addEventListener('pause',()=>$('playPause').textContent='▶');
  audio.addEventListener('timeupdate',()=>{
    $('currentTime').textContent=fmt(audio.currentTime);
    $('duration').textContent=fmt(audio.duration);
    if(Number.isFinite(audio.duration)&&audio.duration>0)$('seekBar').value=Math.round((audio.currentTime/audio.duration)*1000);
  });
  audio.addEventListener('loadedmetadata',()=>{$('duration').textContent=fmt(audio.duration);});
  audio.addEventListener('ended',()=>{if(!repeat)moveTrack(1);});
  audio.addEventListener('error',()=>{if(currentTrackId)notify('This file format may not be supported by your browser.');});
  window.addEventListener('beforeunload',()=>{if(audio.dataset.objectUrl)URL.revokeObjectURL(audio.dataset.objectUrl);});
  async function init() {
    try {
      db=await openDB();
      await reload();
    } catch(error) {
      console.error(error);
      notify('Storage unavailable. Try opening the app in Chrome.');
    }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('Offline cache setup failed:',error));
    }
  }
  init();
})();