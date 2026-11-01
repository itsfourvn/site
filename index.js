const animatedNameLogo = document.querySelector('.name-logo');
if (animatedNameLogo) {
    fetch(animatedNameLogo.src)
        .then(response => response.ok ? response.blob() : null)
        .then(svgBlob => {
            if (!svgBlob) return;

            let activeLogoUrl = '';
            function restartNameLogo() {
                const nextLogoUrl = URL.createObjectURL(svgBlob);
                const previousLogoUrl = activeLogoUrl;
                activeLogoUrl = nextLogoUrl;
                animatedNameLogo.addEventListener('load', () => {
                    if (previousLogoUrl) URL.revokeObjectURL(previousLogoUrl);
                // The SVG finishes its white transition at about 3.1s; hold it
                // white for another 6s before restarting the drawing.
                setTimeout(restartNameLogo, 9100);
                }, { once: true });
                animatedNameLogo.src = nextLogoUrl;
            }

            setTimeout(restartNameLogo, 9100);
        })
        .catch(() => {});
}

const musicPlayer = document.querySelector('.music-player');
if (musicPlayer) {
    const audio = musicPlayer.querySelector('audio');
    const toggleButton = musicPlayer.querySelector('.music-toggle');
    const progress = musicPlayer.querySelector('.music-progress');
    audio.volume = 0.1;
    let musicTracks = [];
    let currentTrackIndex = -1;

    function startMusic() {
        return audio.play();
    }

    function selectMusicTrack(index, autoplay = false) {
        if (musicTracks.length === 0) return;
        currentTrackIndex = (index + musicTracks.length) % musicTracks.length;
        const track = musicTracks[currentTrackIndex];
        audio.src = track.src;
        musicPlayer.title = track.title;
        audio.load();
        if (autoplay) startMusic().catch(() => {});
    }

    function updateMusicProgress() {
        const ratio = Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.currentTime / audio.duration
            : 0;
        const percentage = ratio * 100;
        progress.value = percentage;
        progress.style.setProperty('--progress', `${percentage}%`);
    }

    function resumeMusicOnInteraction(event) {
        if (event.target.closest('#music-toggle')) return;
        if (audio.paused && audio.src) audio.play().catch(() => {});
        document.removeEventListener('pointerdown', resumeMusicOnInteraction);
    }
    document.addEventListener('pointerdown', resumeMusicOnInteraction);

    fetch('/music/tracks.json', { cache: 'no-store' })
        .then(response => response.ok ? response.json() : [])
        .then(tracks => {
            musicTracks = Array.isArray(tracks)
                ? tracks.filter(track => track && typeof track.src === 'string' && track.src.startsWith('/music/'))
                : [];
            if (musicTracks.length) {
                selectMusicTrack(0);
                startMusic().catch(() => {});
            }
            else musicPlayer.title = 'No playable music files found in the music folder';
        })
        .catch(() => {
            musicPlayer.title = 'Could not load the music playlist';
        });

    toggleButton.addEventListener('click', async () => {
        if (audio.paused) {
            try {
                if (!audio.src && musicTracks.length) selectMusicTrack(currentTrackIndex < 0 ? 0 : currentTrackIndex);
                await audio.play();
            } catch {
                musicPlayer.title = 'Unable to play the selected music file';
            }
        } else {
            audio.pause();
        }
    });

    audio.addEventListener('play', () => {
        musicPlayer.classList.add('is-playing');
        toggleButton.setAttribute('aria-label', 'Pause music');
        toggleButton.title = 'Pause music';
    });
    audio.addEventListener('pause', () => {
        musicPlayer.classList.remove('is-playing');
        toggleButton.setAttribute('aria-label', 'Play music');
        toggleButton.title = 'Play music';
    });

    audio.addEventListener('ended', () => selectMusicTrack(currentTrackIndex + 1, true));
    audio.addEventListener('timeupdate', updateMusicProgress);
    audio.addEventListener('loadedmetadata', updateMusicProgress);
    audio.addEventListener('durationchange', updateMusicProgress);
    progress.addEventListener('input', () => {
        if (Number.isFinite(audio.duration)) {
            audio.currentTime = (Number(progress.value) / 100) * audio.duration;
            progress.style.setProperty('--progress', `${progress.value}%`);
        }
    });
    audio.addEventListener('error', () => {
        musicPlayer.title = 'Unable to play the selected music file';
    });
}

updateScrollPercent();
['scroll', 'resize'].forEach(event => addEventListener(event, updateScrollPercent));

function updateScrollPercent() {
    document.body.style.setProperty('--scroll', scrollY / Math.max(innerHeight, 1));
}

const background = document.querySelector('.background');
const cursorGlow = document.querySelector('.cursor-glow');
const hasFinePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

let backgroundVideoSources = [];
const backgroundVideos = [...document.querySelectorAll('.background-video')];

if (backgroundVideos.length === 2) {
    let activeVideo = 0;
    let activeSource = 0;
    let switchingVideo = false;

    function prepareBackgroundVideo(video, sourceIndex) {
        video.src = backgroundVideoSources[sourceIndex];
        video.load();
    }

    async function playAvailableBackgroundVideo(video, firstSourceIndex) {
        for (let attempt = 0; attempt < backgroundVideoSources.length; attempt++) {
            const sourceIndex = (firstSourceIndex + attempt) % backgroundVideoSources.length;
            prepareBackgroundVideo(video, sourceIndex);
            try {
                await video.play();
                return sourceIndex;
            } catch {
                // Skip unsupported or unavailable clips and try the next one.
            }
        }
        return -1;
    }

    async function startBackgroundVideo() {
        try {
            const response = await fetch('/media/videos.json', { cache: 'no-store' });
            if (!response.ok) return;
            const sources = await response.json();
            backgroundVideoSources = sources.filter(source => typeof source === 'string' && source.startsWith('/media/'));
        } catch {
            return;
        }
        if (backgroundVideoSources.length === 0) return;

        const sourceIndex = await playAvailableBackgroundVideo(backgroundVideos[0], 0);
        if (sourceIndex < 0) return;
        activeSource = sourceIndex;
        backgroundVideos[0].classList.add('active');
        prepareBackgroundVideo(backgroundVideos[1], (activeSource + 1) % backgroundVideoSources.length);
    }

    async function advanceBackgroundVideo(endedVideo) {
        if (endedVideo !== backgroundVideos[activeVideo] || switchingVideo || backgroundVideoSources.length === 0) return;
        switchingVideo = true;

        const previousVideo = backgroundVideos[activeVideo];
        const nextVideoIndex = 1 - activeVideo;
        const nextVideo = backgroundVideos[nextVideoIndex];
        const nextSourceIndex = await playAvailableBackgroundVideo(nextVideo, (activeSource + 1) % backgroundVideoSources.length);
        if (nextSourceIndex < 0) {
            switchingVideo = false;
            return;
        }

        nextVideo.classList.add('active');
        previousVideo.classList.remove('active');
        activeVideo = nextVideoIndex;
        activeSource = nextSourceIndex;

        setTimeout(() => {
            previousVideo.pause();
            previousVideo.currentTime = 0;
            prepareBackgroundVideo(previousVideo, (activeSource + 1) % backgroundVideoSources.length);
            switchingVideo = false;
        }, 1400);
    }

    backgroundVideos.forEach(video => video.addEventListener('ended', () => advanceBackgroundVideo(video)));
    startBackgroundVideo();
}

let updating = false;
addEventListener('mousemove', ({ clientX, clientY }) => {
    if (updating) return;
    updating = true;
    requestAnimationFrame(() => {
        background.style.setProperty('--tx', `${20 * (clientX - innerWidth / 2) / innerWidth}px`);
        background.style.setProperty('--ty', `${20 * (clientY - innerHeight / 2) / innerHeight}px`);
        if (hasFinePointer && cursorGlow) {
            cursorGlow.style.setProperty('--cursor-x', `${clientX}px`);
            cursorGlow.style.setProperty('--cursor-y', `${clientY}px`);
            cursorGlow.classList.add('visible');
        }
        updating = false;
    });
});

document.querySelector('.arrow svg').addEventListener('click', () => {
    window.scrollTo({ top: innerHeight * 0.3, behavior: 'smooth' });
});

const DISCORD_ID = '458318691172352012';
const discordWidget = document.querySelector('.discord');

function renderDiscord(presence) {
    if (!presence?.discord_user || !discordWidget) return;

    const { discord_user: user, discord_status: status } = presence;
    const avatar = discordWidget.querySelector('.avatar');
    const avatarUrl = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=80`
        : `https://cdn.discordapp.com/embed/avatars/${Number(user.id) % 6}.png`;
    avatar.style.backgroundImage = `url("${avatarUrl}")`;

    discordWidget.querySelector('.display-name').textContent = user.global_name || user.display_name || user.username;
    const color = { online: '#4b8', idle: '#fa1', dnd: '#f44', offline: '#778' }[status] || '#778';
    discordWidget.querySelector('.color-dot').style.backgroundColor = color;

    const activity = (presence.activities || []).find(item => item.type !== 4);
    discordWidget.querySelector('.status').textContent = activity
        ? ['Playing', 'Streaming to', 'Listening to', 'Watching', 'Custom status', 'Competing in'][activity.type] || 'Active'
        : status;
    discordWidget.querySelector('.activity').textContent = activity?.name || '';
    discordWidget.querySelector('.details').textContent = activity?.details || '';
    discordWidget.querySelector('.state').textContent = activity?.state || '';

    const large = discordWidget.querySelector('.large-image');
    const small = discordWidget.querySelector('.small-image');
    const largeAsset = activity?.assets?.large_image;
    const smallAsset = activity?.assets?.small_image;
    large.style.backgroundImage = largeAsset ? `url("${discordAssetUrl(largeAsset, activity, 160)}")` : '';
    small.style.backgroundImage = smallAsset ? `url("${discordAssetUrl(smallAsset, activity, 60)}")` : '';
    large.title = activity?.assets?.large_text || '';
    small.title = activity?.assets?.small_text || '';
}

function discordAssetUrl(asset, activity, size) {
    if (asset.startsWith('mp:')) return `https://media.discordapp.net/${asset.slice(3)}?width=${size}&height=${size}`;
    if (asset.startsWith('spotify:')) return `https://i.scdn.co/image/${asset.slice(8)}`;
    return `https://cdn.discordapp.com/app-assets/${activity.application_id}/${asset}.png?size=${size}`;
}

fetch('/fetchlanyard').then(response => response.ok ? response.json() : null)
    .then(renderDiscord).catch(() => {});

const discordInviteCard = document.querySelector('.discord-invite-preview');
if (discordInviteCard) {
    fetch('/fetchdiscordinvite')
        .then(response => response.ok ? response.json() : null)
        .then(invite => {
            if (!invite) throw new Error('Discord invite unavailable');
            discordInviteCard.querySelector('.discord-invite-name').textContent = invite.name;
            discordInviteCard.querySelector('.discord-online-count').textContent = invite.online ?? '—';
            discordInviteCard.querySelector('.discord-member-count').textContent = invite.members ?? '—';
            if (invite.icon) {
                const avatar = discordInviteCard.querySelector('.discord-invite-avatar');
                const image = document.createElement('img');
                image.src = invite.icon;
                image.alt = '';
                avatar.replaceChildren(image);
            }
        })
        .catch(() => {
            discordInviteCard.querySelector('.discord-invite-name').textContent = 'Open Discord invite';
        });
}

function connectDiscordPresence() {
    const socket = new WebSocket('wss://api.lanyard.rest/socket');
    let heartbeat;

    socket.addEventListener('message', ({ data }) => {
        const message = JSON.parse(data);
        if (message.op === 1) {
            heartbeat = setInterval(() => {
                if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 3 }));
            }, message.d.heartbeat_interval);
            socket.send(JSON.stringify({ op: 2, d: { subscribe_to_id: DISCORD_ID } }));
            return;
        }
        if (message.t === 'INIT_STATE' || message.t === 'PRESENCE_UPDATE') renderDiscord(message.d);
    });

    socket.addEventListener('close', () => {
        clearInterval(heartbeat);
        setTimeout(connectDiscordPresence, 5000);
    });
    socket.addEventListener('error', () => socket.close());
}

connectDiscordPresence();
const githubProjects = document.querySelector('#github-projects');
const githubProjectTemplate = githubProjects?.querySelector('.project')?.cloneNode(true);
if (githubProjects) {
    const status = document.createElement('div');
    status.className = 'repo-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Loading GitHub repositories...';
    githubProjects.replaceChildren(status);
}

fetch('/fetchgithub').then(async response => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'GitHub request failed.');
    if (!Array.isArray(data.repositories) || !Array.isArray(data.stats) || !Array.isArray(data.languages)) {
        throw new Error('GitHub returned an invalid response.');
    }
    return data;
}).then(data => {
    document.querySelectorAll('.stat').forEach((element, index) => {
        element.textContent = data.stats[index] ?? '-';
    });
    renderGitHubLanguages(data.languages);

    if (!githubProjects || !githubProjectTemplate) return;
    if (!data.repositories.length) {
        const status = document.createElement('div');
        status.className = 'repo-status';
        status.setAttribute('role', 'status');
        status.textContent = 'No public GitHub repositories found.';
        githubProjects.replaceChildren(status);
        return;
    }

    const cards = document.createDocumentFragment();
    data.repositories.forEach(repository => {
        const card = githubProjectTemplate.cloneNode(true);
        const link = card.querySelector('a');
        link.href = repository.url;
        link.querySelector('.bold').textContent = `itsfourvn/${repository.name}`;
        link.querySelector('.opaque').textContent = repository.description || 'No description';
        card.querySelector('.star').textContent = repository.stargazerCount;
        card.querySelector('.fork').textContent = repository.forkCount;

        const language = card.querySelector('.lang');
        language.replaceChildren();
        if (repository.primaryLanguage) {
            const colorDot = document.createElement('span');
            colorDot.className = 'color-dot';
            colorDot.style.backgroundColor = repository.primaryLanguage.color || 'transparent';
            language.append(colorDot, document.createTextNode(repository.primaryLanguage.name));
        } else {
            language.textContent = 'Other';
        }
        cards.append(card);
    });
    githubProjects.replaceChildren(cards);
}).catch(error => {
    console.error('Unable to load GitHub repositories:', error);
    if (!githubProjects) return;
    const status = document.createElement('div');
    status.className = 'repo-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Could not load GitHub repositories.';
    githubProjects.replaceChildren(status);
});

function renderGitHubLanguages(languages) {
    const chart = document.querySelector('.github-languages');
    const progress = chart?.querySelector('.language-progress');
    const legend = chart?.querySelector('.language-legend');
    if (!progress || !legend) return;

    progress.replaceChildren();
    legend.replaceChildren();
    const languageCount = chart.querySelector('.language-count');
    if (languageCount) languageCount.textContent = `${languages.length} languages`;
    if (!languages.length) {
        legend.textContent = 'No language data available.';
        return;
    }

    progress.setAttribute('aria-label', languages
        .map(language => `${language.name}: ${language.percentage.toFixed(2)}%`)
        .join(', '));

    const segments = document.createDocumentFragment();
    const entries = document.createDocumentFragment();
    languages.forEach(language => {
        const color = language.color || '#6e7781';
        const segment = document.createElement('span');
        segment.className = 'language-progress-item';
        segment.style.width = `${language.percentage}%`;
        segment.style.backgroundColor = color;
        segments.append(segment);

        const item = document.createElement('li');
        item.title = `${language.name}: ${language.percentage.toFixed(2)}%`;
        const dot = document.createElement('span');
        dot.className = 'language-dot';
        dot.style.backgroundColor = color;

        const name = document.createElement('span');
        name.className = 'language-name';
        name.textContent = language.name;

        const percentage = document.createElement('span');
        percentage.className = 'language-percentage';
        percentage.textContent = `${language.percentage.toFixed(2)}%`;

        item.append(dot, name, percentage);
        entries.append(item);
    });
    progress.replaceChildren(segments);
    legend.replaceChildren(entries);
}

const clock = document.querySelector('.clock');
if (clock) {
    const dateFormatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
    });

    function updateClock() {
        const now = new Date();
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
        }).formatToParts(now).map(part => [part.type, part.value]));
        const { hour, minute, second } = parts;
        const dateParts = Object.fromEntries(dateFormatter.formatToParts(now).map(part => [part.type, part.value]));
        const dateText = `${dateParts.day}/${dateParts.month}/${dateParts.year}`;
        const timeText = `${hour}:${minute}:${second}`;

        clock.querySelector('.date').textContent = dateText;
        clock.querySelector('.date-container').dateTime = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
        clock.querySelector('.hour').textContent = hour;
        clock.querySelector('.minute').textContent = minute;
        clock.querySelector('.second').textContent = second;
        clock.querySelector('.time-container').dateTime = timeText;

        const hourNumber = Number(hour);
        const minuteNumber = Number(minute);
        const secondNumber = Number(second);
        clock.querySelector('.hour-hand').style.transform = `rotate(${(hourNumber % 12) * 30 + minuteNumber * .5 + secondNumber / 120}deg)`;
        clock.querySelector('.minute-hand').style.transform = `rotate(${minuteNumber * 6 + secondNumber * .1}deg)`;
        clock.querySelector('.second-hand').style.transform = `rotate(${secondNumber * 6}deg)`;

        const difference = (420 + now.getTimezoneOffset()) / 60;
        const differenceLabel = difference === 0
            ? 'same time'
            : `${Math.abs(difference)}h ${difference > 0 ? 'ahead' : 'behind'}`;
        clock.querySelector('.timezone-diff').textContent = differenceLabel;
        clock.querySelector('.utc-offset').textContent = ' / UTC +7:00';
        clock.querySelector('.utc-offset').dateTime = '+07:00';

        setTimeout(updateClock, 1000 - Date.now() % 1000);
    }

    updateClock();
}
